import 'dotenv/config';
import { supabase } from '../src/lib/supabase';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.VITE_DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com'
});

async function migrateExplanations() {
  console.log('🚀 Starting Explanation Migration to 3rd-Grade Step-by-Step Format...');

  try {
    // 1. Fetch questions that need migration
    const { data: questions, error } = await supabase
      .from('questions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(150); 

    if (error) throw error;
    if (!questions || questions.length === 0) {
      console.log('✅ No questions found needing migration.');
      return;
    }

    console.log(`Found ${questions.length} questions to migrate.`);

    for (const q of questions) {
      console.log(`\n📄 Migrating [${q.subject_code}] ${q.topic}: ${q.question_text.substring(0, 40)}...`);

      try {
        const prompt = `
          You are an expert pedagogy assistant.
          Rewrite the following scientific/educational explanation into exactly 5-7 simple, numbered steps.
          
          READABILITY RULES: 
          - Target a 9-year-old child (3rd-grade reading level).
          - Use very short sentences.
          - Use simple words (e.g., 'get smaller' instead of 'decrease').
          - Use real-life examples in brackets [like a falling ball] for any complex concept.
          
          ORIGINAL EXPLANATION:
          ${q.explanation_json?.why_correct || q.model_answer}
          
          QUESTION:
          ${q.question_text}
          
          Return your response in JSON format:
          { "explanation_steps": ["Step 1...", "Step 2...", ...] }
        `;

        const response = await openai.chat.completions.create({
          model: "deepseek-chat",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          temperature: 0.3,
        });

        const result = JSON.parse(response.choices[0].message.content || '{}');
        const steps = result.explanation_steps;

        if (steps && Array.isArray(steps) && steps.length >= 3) {
          console.log(`   ✨ Generated ${steps.length} steps.`);
          
          const { error: updateError } = await supabase
            .from('questions')
            .update({ explanation_steps: steps })
            .eq('id', q.id);

          if (updateError) throw updateError;
          console.log(`   ✅ Successfully updated database.`);
        } else {
          console.warn(`   ⚠️ AI failed to produce valid steps. Skipping.`);
        }

      } catch (err: any) {
        console.error(`   ❌ Failed to migrate question ${q.id}:`, err.message);
      }

      // Small delay to prevent rate limits
      await new Promise(res => setTimeout(res, 500));
    }

    console.log('\n🎉 Migration complete!');

  } catch (err) {
    console.error('\n💥 Critical Error during migration:', err);
  }
}

migrateExplanations();
