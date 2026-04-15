import { Type } from "@google/genai";
import { Question, SyllabusConfirmation } from "../types";
import { db, auth } from "../lib/firebase";
import { collection, doc, setDoc, writeBatch } from "firebase/firestore";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const useOllama = import.meta.env.VITE_USE_OLLAMA === "true";
const ollamaBaseUrl = import.meta.env.VITE_OLLAMA_BASE_URL || "http://localhost:11434";
const ollamaModel = import.meta.env.VITE_OLLAMA_MODEL || "gemma";

async function* ollamaGenerateContentStream(prompt: string, onPartialQuestion?: (partialText: string) => void) {
  const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      prompt,
      stream: true,
      format: "json"
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.response) {
          fullText += data.response;
          const matches = [...fullText.matchAll(/"question_text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)/g)];
          if (matches.length > 0) {
            onPartialQuestion?.(matches[matches.length - 1][1]);
          }
          yield { text: fullText };
        }
      } catch (e) {
        // Skip invalid JSON lines
      }
    }
  }
}

export async function saveQuestionBank(
  subjectName: string,
  subjectCode: string,
  questions: Question[]
) {
  if (!auth.currentUser) throw new Error("User must be authenticated to save questions");

  const bankId = `${subjectCode}_${Date.now()}`;
  const bankRef = doc(db, "question_banks", bankId);

  await setDoc(bankRef, {
    id: bankId,
    subject_code: subjectCode,
    subject_name: subjectName,
    total_questions: questions.length,
    created_at: new Date().toISOString(),
    user_id: auth.currentUser.uid
  });

  const batch = writeBatch(db);
  questions.forEach((q) => {
    const qRef = doc(collection(db, "question_banks", bankId, "questions"));
    batch.set(qRef, { ...q, created_at: new Date().toISOString() });
  });

  await batch.commit();
  return bankId;
}

export async function verifySyllabus(subjectName: string, subjectCode: string, coveredTopics: string[]): Promise<SyllabusConfirmation> {
  const prompt = `
    Confirm the Cambridge IGCSE 2027 syllabus for ${subjectName} (Code: ${subjectCode}).
    Cross-reference with these covered topics: ${coveredTopics.join(", ")}.
    
    Identify gaps (topics in syllabus but not in covered list) and any changes for 2027.
    Return the result in JSON format.
  `;

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      subject: { type: Type.STRING },
      code: { type: Type.STRING },
      verified: { type: Type.BOOLEAN },
      topics_matched: { type: Type.ARRAY, items: { type: Type.STRING } },
      gaps_identified: { type: Type.ARRAY, items: { type: Type.STRING } },
      recommendations: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ["subject", "code", "verified", "topics_matched", "gaps_identified", "recommendations"]
  };

  const response = await fetch('/api/verifySyllabus', {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, responseSchema })
  });

  if (!response.ok) {
    throw new Error(`Failed to verify syllabus: ${response.statusText}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return JSON.parse(rawText);
}

export async function generateQuestionsBatch(
  subjectName: string, 
  subjectCode: string, 
  topics: string[], 
  count: number,
  type: 'covered' | 'preview' | 'stretch',
  onProgress?: (progress: number, message: string) => void,
  diagramPreferences?: { type: string, referenceImage?: { data: string, mimeType: string } },
  existingQuestions: string[] = [],
  onBatchComplete?: (questions: Question[]) => void,
  onPartialQuestion?: (partialText: string) => void,
  signal?: AbortSignal
): Promise<Question[]> {
  const batchSize = 1; // Extremely low batch size to guarantee sub-10 second TTFB and prevent Vercel 504 Edge Timeouts
  let allQuestions: Question[] = [];
  let totalAttempts = 0;
  const maxTotalAttempts = Math.ceil(count / batchSize) * 3; // Prevent infinite loops

  while (allQuestions.length < count && totalAttempts < maxTotalAttempts) {
    if (signal?.aborted) {
      console.log("Generation loop aborted by user");
      break;
    }

    const remainingCount = count - allQuestions.length;
    const currentBatchCount = Math.min(batchSize, remainingCount);
    
    onProgress?.(
      Math.round((allQuestions.length / count) * 100), 
      `Generating questions... (${allQuestions.length}/${count} complete)`
    );

    let diagramPrompt = "- DIAGRAMS: ONLY include a diagram if it is ABSOLUTELY NECESSARY to answer the question. Do NOT force diagrams. Do NOT repeat the same diagram design with different numbers.";
    if (diagramPreferences?.type && diagramPreferences.type !== 'Auto') {
      diagramPrompt = `- DIAGRAMS: If a diagram is ABSOLUTELY NECESSARY, focus on including ${diagramPreferences.type} SVG diagrams. Do NOT force diagrams if not needed.`;
    }
    diagramPrompt += `\n      - CRITICAL DIAGRAM RULES: If you generate an SVG diagram, it MUST be complete. Use a generous \`viewBox\` (e.g., \`0 0 500 500\`) and leave plenty of margin/padding around the edges so no text or lines are cut off. It MUST have clear x and y axes with labels and numbers/units if it's a graph. Any label referenced in the question (e.g., D1, D2, Point X, Curve A) MUST be explicitly drawn and visible in the SVG text elements well within the boundaries. Do not generate a question about a label that is missing from the diagram.
      - NO ANSWERS IN DIAGRAMS: The diagram MUST NOT reveal the answer to the question. For example, if the question asks to find the price, the price axis in the diagram should have a placeholder like 'P' or '?' instead of the actual answer value. If the question asks to identify a curve, label it 'Curve A' instead of 'Supply Curve'.`;
    
    if (diagramPreferences?.referenceImage) {
      diagramPrompt += `\n      - A reference sketch/image is provided. Refine this sketch into accurate, professional SVG representations for the visual aids in the questions where relevant.`;
    }

    const recentFromSession = allQuestions.map(q => q.question_text).slice(-20);
    const recentFromDB = existingQuestions.slice(0, 30);
    const combinedQuestions = [...recentFromSession, ...recentFromDB];

    let duplicatePreventionPrompt = "";
    if (combinedQuestions.length > 0) {
      duplicatePreventionPrompt = `
      - DUPLICATE PREVENTION: You MUST NOT generate questions that are conceptually similar to these already-existing questions:
      ${combinedQuestions.map(q => `- ${q}`).join('\n')}
      - STRICT RULE: Do NOT just create basic variations of these questions by simply swapping numbers, names, or minor details. You must generate entirely new conceptual testing angles, testing different parts of the syllabus!
      `;
    }

    const prompt = `
      You are a Cambridge IGCSE research and content-ingestion assistant for Focused Scholar V3.
      Generate ${currentBatchCount} high-quality Cambridge IGCSE questions for ${subjectName} (${subjectCode}).
      Category: ${type} (covered topics: ${topics.join(", ")}).
      
      Requirements:
      - QUESTION STYLE: Use actual Cambridge paper styles (2023-2025) and standard command words.
      - VALIDATION: Every question MUST have a non-empty \`question_text\`. Do not return blank questions.
      - EXTREMELY SIMPLE EXPLANATIONS: Explain the answers as if you are talking to a 10-year-old. Use very simple, everyday English (e.g., use "low" instead of "reduction", "other choices" instead of "alternative").
      - GO DEEP & DETAILED: Do not hold back or summarize. Provide extremely detailed, step-by-step explanations so the student can fully understand the complex principles and get an A+.
      - REAL-LIFE EXAMPLES: Whenever you use a complex or subject-specific term (like "resources", "capital goods", "opportunity cost"), you MUST provide a real-life, everyday example in brackets immediately after it. (e.g., "resources [like food, water, or money]", "capital goods [like machines or factory buildings]").
      - MULTIPLE CHOICE FORMAT: For \`multiple_choice_single\` and \`multiple_choice_multiple\`, you MUST include options in the \`options_json\` array in this EXACT format: "Letter. Option text" (e.g., "A. 2 m/s²"). Exactly 4 options for single choice. The \`correct_answer\` field MUST be just the letter (e.g., "B").
      - DIAGRAM BREAKDOWNS: If the question includes a diagram, explicitly explain it point-by-point in the explanation. Ensure the SVG code is perfectly valid, self-contained, and uses standard SVG elements (<svg>, <rect>, <circle>, <path>, <text>, <g>, <line>).
      - DIAGRAMS: If a diagram is needed, output the raw SVG code in the \`_raw_svg\` field. Leave \`diagram_url\` empty or null.
      ${diagramPrompt}
      ${duplicatePreventionPrompt}
      - NUMERICAL QUESTIONS: Provide step-by-step calculations explaining exactly WHY each step is taken (e.g., "Step one: we start with this. We add these two because that's the only way...").
      
      Return an array of questions in JSON format matching the schema.
    `;

    const parts: any[] = [{ text: prompt }];
    if (diagramPreferences?.referenceImage) {
      parts.push({
        inlineData: {
          data: diagramPreferences.referenceImage.data,
          mimeType: diagramPreferences.referenceImage.mimeType
        }
      });
    }

    let success = false;
    let attempts = 0;

    while (!success && attempts < 3) {
      try {
        attempts++;
        
        let text = "";
        
        if (useOllama) {
          for await (const chunk of ollamaGenerateContentStream(prompt, onPartialQuestion)) {
            text += chunk.text;
          }
        } else {
          const responseSchema = {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                topic: { type: Type.STRING },
                subtopic: { type: Type.STRING },
                question_text: { type: Type.STRING },
                question_type: { type: Type.STRING },
                options_json: { type: Type.ARRAY, items: { type: Type.STRING } },
                correct_answer: { type: Type.STRING },
                model_answer: { type: Type.STRING },
                explanation_json: {
                  type: Type.OBJECT,
                  properties: {
                    why_correct: { type: Type.STRING },
                    key_understanding: { type: Type.STRING }
                  }
                },
                key_points_json: { type: Type.ARRAY, items: { type: Type.STRING } },
                marks: { type: Type.NUMBER },
                diagram_url: { type: Type.STRING },
                diagram_type: { type: Type.STRING },
                _raw_svg: { type: Type.STRING },
                difficulty: { type: Type.NUMBER },
                time_estimate: { type: Type.NUMBER }
              }
            }
          };

          // Check for manual abort
          if (signal?.aborted) {
            console.log("Generation aborted by user");
            break;
          }

          const response = await fetch('/api/generateStream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, diagramPreferences, responseSchema }),
            signal
          });

          if (!response.ok) {
             throw new Error(`API error: ${response.status} ${response.statusText}`);
          }

          // The backend returns the complete question JSON as plain text — no SSE parsing needed.
          text = await response.text();
          // Signal a partial question update with the first question_text found, for live UI feedback
          const previewMatch = text.match(/"question_text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
          if (previewMatch?.[1]) onPartialQuestion?.(previewMatch[1]);
        }

        const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const batchQuestions = JSON.parse(cleanedText) as Question[];
        
        // Filter out invalid questions (e.g., empty question text)
        const validQuestions = batchQuestions.filter(q => 
          q && q.question_text && q.question_text.trim().length > 0 &&
          q.model_answer && q.model_answer.trim().length > 0
        ).map(q => ({
          ...q,
          client_temp_id: Math.random().toString(36).substring(2, 15),
          subject_code: subjectCode,
          source: 'research-agent'
        }));

        if (validQuestions.length > 0) {
          allQuestions = [...allQuestions, ...validQuestions];
          // Ensure we don't exceed the requested count
          if (allQuestions.length > count) {
            allQuestions = allQuestions.slice(0, count);
          }
          onBatchComplete?.(allQuestions);
          success = true;
        } else {
          throw new Error("AI returned no valid questions in this batch.");
        }
      } catch (error: any) {
        console.error(`Batch failed (attempt ${attempts}):`, error);
        
        // Check for rate limit error (429)
        const isRateLimit = error?.message?.includes('429') || error?.status === 'RESOURCE_EXHAUSTED';
        
        if (isRateLimit && attempts < 3) {
          const delay = Math.pow(2, attempts) * 2000; // 4s, 8s
          onProgress?.(
            Math.round((allQuestions.length / count) * 100), 
            `Rate limit hit. Waiting ${delay/1000}s before retry...`
          );
          await sleep(delay);
          continue;
        }

        if (attempts >= 3) {
          console.warn(`Failed to generate valid JSON after 3 attempts for this batch. Moving on.`);
          success = true; // Break the inner loop to try a fresh batch in the outer loop
        }
      }
    }
    
    // Add a small delay between successful batches to avoid hitting rate limits
    if (allQuestions.length < count) {
      await sleep(1000);
    }
    totalAttempts++;
  }

  if (allQuestions.length < count) {
    console.warn(`Only generated ${allQuestions.length} out of ${count} requested questions after maximum attempts.`);
  }

  onProgress?.(100, `Generation complete! ${allQuestions.length} questions ready.`);
  return allQuestions;
}

export async function regenerateDiagramForQuestion(question: Question): Promise<string> {
  const prompt = `
  You are an expert Cambridge IGCSE diagram generator.
  The following question requires a visual diagram, but the SVG code is missing.
  
  Question: "${question.question_text}"
  Model Answer/Context: "${question.model_answer}"
  
  Requirements:
  1. Generate ONLY the raw SVG code for this diagram.
  2. Use a generous viewBox (e.g., 0 0 500 500) and ensure no text or lines are cut off.
  3. Respond with perfectly valid XML <svg>...</svg>. DO NOT wrap it in a JSON object.
  4. Include the xmlns attribute xmlns="http://www.w3.org/2000/svg".
  5. DO NOT output any conversational text or markdown around the SVG. Just the raw XML string.
  `;

  try {
    const response = await fetch('/api/regenerateDiagram', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    let cleanSvg = rawText.trim();
    const match = cleanSvg.match(/<svg[\s\S]*<\/svg>/i);
    if (match) {
      cleanSvg = match[0];
    }
    
    if (!cleanSvg.includes('xmlns=')) {
      cleanSvg = cleanSvg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    return cleanSvg;
  } catch (err) {
    console.error("Failed to regenerate diagram:", err);
    throw err;
  }
}