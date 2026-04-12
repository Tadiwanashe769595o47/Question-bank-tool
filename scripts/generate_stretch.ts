import { GoogleGenAI, Type } from "@google/genai";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const subjects = [
  { name: "Mathematics", code: "0580" },
  { name: "Biology", code: "0610" },
  { name: "Chemistry", code: "0620" },
  { name: "Physics", code: "0625" },
  { name: "Computer Science", code: "0478" },
  { name: "Geography", code: "0460" },
  { name: "Accounting", code: "0452" },
  { name: "Economics", code: "0455" },
  { name: "English First Language", code: "0500" },
  { name: "English Second Language", code: "0510" }
];

async function generateStretchQuestions(subject: { name: string, code: string }) {
  console.log(`Generating stretch questions for ${subject.name} (${subject.code})...`);
  
  const prompt = `
    Generate 5 challenging 'Stretch Topic' questions for Cambridge IGCSE ${subject.name} (${subject.code}).
    
    Requirements:
    1. Questions must require deep analysis, synthesis of multiple concepts, or application to novel scenarios.
    2. ESL-friendly (3rd grade reading level) but conceptually advanced.
    3. For calculations: Show step-by-step reasoning. Format: "Step one: we do this... We add these two because...".
    4. For financial concepts (Accounting/Economics): Explain why the principle is correct and explain any alternative principles that may be confused for it and why they are incorrect.
    5. Include SVG diagrams for at least 3 of the 5 questions.
    6. Follow the JSON structure provided in the previous instructions.
    
    Return an array of 5 questions.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            subject_code: { type: Type.STRING },
            topic: { type: Type.STRING },
            subtopic: { type: Type.STRING },
            question_text: { type: Type.STRING },
            question_type: { type: Type.STRING },
            options: { type: Type.ARRAY, items: { type: Type.STRING } },
            diagram: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING },
                data: { type: Type.STRING },
                description: { type: Type.STRING }
              }
            },
            marks: { type: Type.NUMBER },
            difficulty: { type: Type.NUMBER },
            time_estimate_seconds: { type: Type.NUMBER },
            answer: {
              type: Type.OBJECT,
              properties: {
                correct_answer: { type: Type.STRING },
                acceptable_answers: { type: Type.ARRAY, items: { type: Type.STRING } },
                model_answer: { type: Type.STRING },
                model_answer_format: { type: Type.STRING }
              }
            },
            explanation: {
              type: Type.OBJECT,
              properties: {
                why_correct: { type: Type.STRING },
                why_this_method: { type: Type.STRING },
                why_not_others: { type: Type.STRING },
                key_understanding: { type: Type.ARRAY, items: { type: Type.STRING } },
                common_mistakes: { type: Type.ARRAY, items: { type: Type.STRING } },
                tip_for_exam: { type: Type.STRING },
                alternative_methods: { type: Type.ARRAY, items: { type: Type.STRING } }
              }
            },
            mark_scheme: {
              type: Type.OBJECT,
              properties: {
                method_marks: { type: Type.ARRAY, items: { type: Type.STRING } },
                keywords_needed: { type: Type.ARRAY, items: { type: Type.STRING } },
                full_marks_conditions: { type: Type.STRING }
              }
            },
            esl_support: {
              type: Type.OBJECT,
              properties: {
                simple_meaning: { type: Type.STRING },
                example: { type: Type.STRING },
                visual_aid: { type: Type.STRING }
              }
            }
          }
        }
      }
    }
  });

  return JSON.parse(response.text);
}

async function main() {
  const allQuestions: any[] = [];
  
  for (const subject of subjects) {
    try {
      const questions = await generateStretchQuestions(subject);
      allQuestions.push(...questions);
    } catch (error) {
      console.error(`Failed for ${subject.name}:`, error);
    }
  }
  
  fs.writeFileSync(
    path.join(process.cwd(), "src/data/stretch_questions.json"),
    JSON.stringify(allQuestions, null, 2)
  );
  console.log("Generation complete!");
}

main();
