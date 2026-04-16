import 'dotenv/config';
import OpenAI from "openai";
import { Question, SyllabusConfirmation } from "../types";

// Helper to get environment variables across Vite and Node
const getEnv = (key: string) => {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env[key];
  }
  return process.env[key];
};

const providers = {
  openai: {
    apiKey: getEnv("VITE_OPENAI_API_KEY"),
    baseURL: undefined, // Defaults to OpenAI
    model: "gpt-4o"
  },
  nvidia: {
    apiKey: getEnv("VITE_NVIDIA_API_KEY"),
    baseURL: "https://integrate.api.nvidia.com/v1",
    model: "minimaxai/minimax-m2.7" // High performance reasoning model
  },
  deepseek: {
    apiKey: getEnv("VITE_DEEPSEEK_API_KEY"),
    baseURL: "https://api.deepseek.com",
    model: "deepseek-chat"
  }
};

const currentProvider = getEnv("AI_PROVIDER") || "nvidia";
const config = providers[currentProvider as keyof typeof providers];

const openai = new OpenAI({
  apiKey: config.apiKey,
  baseURL: config.baseURL,
  dangerouslyAllowBrowser: true // For Vite frontend use
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function stripThinkTags(text: string) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/**
 * Unified Chat Completion that handles JSON mode and provider differences
 */
async function unifiedChatCompletion(prompt: string, responseSchema?: any) {
  try {
    const response = await openai.chat.completions.create({
      model: config.model,
      messages: [
        { 
          role: "system", 
          content: `You are an expert Cambridge IGCSE educational assistant. 
          You must follow the strict JSON schema provided. 
          READABILITY RULE: Use 3rd-grade level English (very simple words, short sentences). 
          EXPLANATION RULE: Always break explanations into 5-7 numbered steps.` 
        },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1, // Low temperature for consistent JSON
    });

    let content = response.choices[0].message.content || "{}";
    content = stripThinkTags(content);
    return JSON.parse(content);
  } catch (error) {
    console.error(`AI Completion Error (${currentProvider}):`, error);
    throw error;
  }
}

export async function verifySyllabus(subjectName: string, subjectCode: string, coveredTopics: string[]): Promise<SyllabusConfirmation> {
  const prompt = `
    Confirm the Cambridge IGCSE 2027 syllabus for ${subjectName} (Code: ${subjectCode}).
    Cross-reference with these covered topics: ${coveredTopics.join(", ")}.
    Identify gaps and recommendations.
    Return in JSON format with: subject, code, verified (boolean), topics_matched (array), gaps_identified (array), recommendations (array).
  `;

  return await unifiedChatCompletion(prompt);
}

export async function generateQuestionsBatch(
  subjectName: string, 
  subjectCode: string, 
  topics: string[], 
  count: number,
  type: 'covered' | 'preview' | 'stretch',
  onProgress?: (progress: number, message: string) => void,
  diagramPreferences?: { type: string },
  existingQuestions: string[] = [],
  onBatchComplete?: (questions: Question[]) => void,
): Promise<Question[]> {
  const prompt = `
    Generate ${count} high-quality Cambridge IGCSE questions for ${subjectName} (${subjectCode}).
    Topics: ${topics.join(", ")}.
    Type: ${type}.

    STRICT RULES:
    1. EXPLANATION: Provide exactly 5-7 numbered steps for every explanation in 'explanation_steps'.
    2. READABILITY: Use language a 9-year-old can understand (3rd-grade level).
    3. EXAMPLES: Use real-life examples in brackets [like a machine].
    4. MATH: Use LaTeX ($ inline, $$ block).
    5. JSON: Return an array called 'questions'.

    JSON Structure for each question:
    - topic, subtopic
    - question_text
    - question_type (multiple_choice_single, multiple_choice_multiple, open_text, etc)
    - options_json (array of "A. Text", etc)
    - correct_answer (letter or text)
    - model_answer
    - explanation_json: { why_correct, key_understanding }
    - explanation_steps: (Array of 5-7 simple strings)
    - key_points_json: (Array of strings)
    - marks (number)
    - difficulty (1-5)
    - time_estimate (minutes)
  `;

  const result = await unifiedChatCompletion(prompt);
  const questions = (result.questions || []) as Question[];
  
  const validQuestions = questions.map(q => ({
    ...q,
    client_temp_id: Math.random().toString(36).substring(2, 15),
    subject_code: subjectCode,
    source: 'ai-refactor'
  }));

  onBatchComplete?.(validQuestions);
  return validQuestions;
}

function mapQuestionFields(raw: any, subjectCode: string): Question {
  return {
    topic: raw.topic || raw.subject || 'General',
    subtopic: raw.subtopic || raw.section || 'General',
    question_text: raw.question_text || raw.text || raw.prompt?.german || raw.prompt?.english || String(raw),
    question_type: raw.question_type || raw.type || 'open_text',
    options_json: raw.options_json || raw.options || (raw.question_type?.includes('multiple') ? [] : null),
    correct_answer: raw.correct_answer || raw.answer || '',
    model_answer: raw.model_answer || raw.marking_guidance || raw.marking_scheme?.question_1_mark_breakdown?.content?.table_reference || '',
    explanation_json: raw.explanation_json || { why_correct: raw.explanation || '', key_understanding: '' },
    explanation_steps: raw.explanation_steps || [],
    key_points_json: raw.key_points_json || raw.key_points || [],
    marks: Number(raw.marks) || 0,
    difficulty: Number(raw.difficulty) || 3,
    time_estimate: Number(raw.time_estimate) || 5,
    subject_code: subjectCode,
    source: 'past-paper-extracted'
  };
}

export async function parsePastPaperQuestions(
  subjectName: string,
  subjectCode: string,
  paperText: string,
  msText: string
): Promise<Question[]> {
  const prompt = `
    Extract questions and match with marking schemes for ${subjectName} (${subjectCode}).
    
    PAPER TEXT: ${paperText.substring(0, 10000)}
    MS TEXT: ${msText.substring(0, 8000)}
    
    STRICT JSON SCHEMA:
    {
      "questions": [
        {
          "topic": "string",
          "subtopic": "string",
          "question_text": "string",
          "question_type": "open_text | multiple_choice_single",
          "options_json": ["A. Choice", "B. Choice"] | null,
          "correct_answer": "string",
          "model_answer": "string",
          "explanation_json": { "why_correct": "string", "key_understanding": "string" },
          "explanation_steps": ["step 1", "step 2", "step 3", "step 4", "step 5"],
          "marks": number,
          "difficulty": number (1-5)
        }
      ]
    }

    STRICT RULES:
    1. EXPLANATION_STEPS: You MUST provide exactly 5-7 numbered steps for every question.
    2. READABILITY: Use 3rd-grade level English (very simple).
    3. MATH: Use LaTeX ($).
  `;

  // Use DeepSeek for reliable extraction if configured, otherwise fallback
  const extractionClient = new OpenAI({
    apiKey: getEnv("VITE_DEEPSEEK_API_KEY") || config.apiKey,
    baseURL: getEnv("VITE_DEEPSEEK_API_KEY") ? "https://api.deepseek.com" : config.baseURL,
    dangerouslyAllowBrowser: true
  });

  const response = await extractionClient.chat.completions.create({
    model: getEnv("VITE_DEEPSEEK_API_KEY") ? "deepseek-chat" : config.model,
    messages: [
      { role: "system", content: "You are a precise data extractor. Return JSON ONLY." },
      { role: "user", content: prompt }
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const rawJson = stripThinkTags(response.choices[0].message.content || "{}");
  const result = JSON.parse(rawJson);
  
  // Handle nested structures or raw arrays
  let rawQuestions = result.questions || (Array.isArray(result) ? result : []);
  
  if (!Array.isArray(rawQuestions) && typeof result === 'object') {
     const possibleKey = Object.keys(result).find(k => Array.isArray(result[k]));
     if (possibleKey) rawQuestions = result[possibleKey];
  }

  if (!Array.isArray(rawQuestions)) rawQuestions = [];

  return rawQuestions.map((q: any) => mapQuestionFields(q, subjectCode));
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
    
    let cleanSvg = data.svg || data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Clean up the SVG
    const match = cleanSvg.match(/<svg[\s\S]*<\/svg>/i);
    if (match) {
      cleanSvg = match[0];
    }
    
    if (!cleanSvg.includes('xmlns=')) {
      cleanSvg = cleanSvg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    
    if (!cleanSvg.match(/\bwidth=/i)) cleanSvg = cleanSvg.replace(/<svg/i, '<svg width="500"');
    if (!cleanSvg.match(/\bheight=/i)) cleanSvg = cleanSvg.replace(/<svg/i, '<svg height="400"');

    return cleanSvg;
  } catch (err) {
    console.error("Failed to regenerate diagram:", err);
    throw err;
  }
}
