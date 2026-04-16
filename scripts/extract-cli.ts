import { config } from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { findPaperLinks, linkPapers } from '../src/services/scraperService';
import { extractTextFromPDF } from '../src/services/paperService';
import { parsePastPaperQuestions } from '../src/services/aiService';
import { pushQuestionsToSupabase } from '../src/services/supabaseService';
import { SUBJECTS } from '../src/constants';

// Load environment variables from .env
config();

async function main() {
  const args = process.argv.slice(2);
  const subjectCode = args[0]; // e.g. "0580"
  const year = parseInt(args[1]); // e.g. "2024"

  if (!subjectCode || !year) {
    console.log('Usage: npx tsx scripts/extract-cli.ts <subjectCode> <year>');
    process.exit(1);
  }

  const subject = SUBJECTS.find(s => s.code === subjectCode);
  if (!subject) {
    console.error(`Subject ${subjectCode} not found in constants.ts`);
    process.exit(1);
  }

  console.log(`\n🚀 Starting Bulk Extraction for ${subject.name} (${subjectCode}) - ${year}\n`);

  try {
    // 1. Find links
    console.log('🔍 Searching for past papers on PapaCambridge...');
    const allLinks = await findPaperLinks(subjectCode, year);
    console.log(`✅ Found ${allLinks.length} total PDF links.`);

    // 2. Link Question Papers with Marking Schemes
    const pairs = linkPapers(allLinks);
    console.log(`🔗 Successfully linked ${pairs.length} paper/ms pairs for extraction.`);

    const allExtractedQuestions: any[] = [];

    // 3. Process each pair
    for (const pair of pairs) {
      if (!pair.marking_scheme) {
        console.warn(`⚠️  No marking scheme found for ${pair.question_paper.name}. Skipping...`);
        continue;
      }

      console.log(`\n📄 Processing: ${pair.question_paper.name}`);
      console.log(`   📄 Marking Scheme: ${pair.marking_scheme.name}`);

      try {
        console.log('   📥 Downloading and extracting text from PDFs...');
        const qpText = await extractTextFromPDF(pair.question_paper.url);
        const msText = await extractTextFromPDF(pair.marking_scheme.url);

        console.log('   🧠 Parsing content with Gemini AI (this may take a minute)...');
        const questions = await parsePastPaperQuestions(
          subject.name,
          subjectCode,
          qpText,
          msText
        );

        console.log(`   ✨ Extracted ${questions.length} questions.`);
        allExtractedQuestions.push(...questions);

        // Optional: Save progress to a local JSON file to prevent loss
        fs.writeFileSync(
          path.join(__dirname, `extraction_progress_${subjectCode}_${year}.json`),
          JSON.stringify(allExtractedQuestions, null, 2)
        );

      } catch (err: any) {
        console.error(`   ❌ Failed to process ${pair.question_paper.name}:`, err.message);
      }
    }

    // 4. Push to Supabase
    if (allExtractedQuestions.length > 0) {
      console.log(`\n⬆️  Pushing ${allExtractedQuestions.length} questions to Supabase...`);
      const result = await pushQuestionsToSupabase(allExtractedQuestions, (progress, message) => {
        console.log(`   [${progress}%] ${message}`);
      });
      
      console.log(`\n🎉 Success! Pushed ${result.successCount} questions.`);
      if (result.failedCount > 0) {
        console.warn(`⚠️  ${result.failedCount} questions failed to upload.`);
      }
    } else {
      console.log('\n❌ No questions were extracted.');
    }

  } catch (error: any) {
    console.error('\n💥 Critical Error in extraction pipeline:', error);
  }
}

main();
