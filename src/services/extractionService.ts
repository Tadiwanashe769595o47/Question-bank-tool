import { PaperLink, findPaperLinks } from './scraperService';
import { extractTextFromPDF } from './paperService';
import { parsePastPaperQuestions } from './aiService';
import { Question } from '../types';

const CORS_PROXY = 'https://corsproxy.io/?';

export interface ExtractionProgress {
  phase: 'idle' | 'discovering' | 'downloading' | 'parsing' | 'review' | 'pushing' | 'complete';
  current: number;
  total: number;
  message: string;
  logs: string[];
}

export interface ExtractionPair {
  question_paper: PaperLink;
  marking_scheme: PaperLink;
  questions?: Question[];
  error?: string;
}

function withCorsProxy(url: string): string {
  return `${CORS_PROXY}${encodeURIComponent(url)}`;
}

function addLog(logs: string[], message: string): string[] {
  return [...logs, message];
}

export async function discoverPapers(
  subjectCode: string,
  year: number,
  onProgress: (progress: ExtractionProgress) => void
): Promise<PaperLink[]> {
  const logs: string[] = [];
  onProgress({
    phase: 'discovering',
    current: 0,
    total: 100,
    message: 'Searching for past papers on PapaCambridge...',
    logs: addLog(logs, `🔍 Starting paper discovery for ${subjectCode} - ${year}`)
  });

  try {
    const links = await findPaperLinks(subjectCode, year);
    onProgress({
      phase: 'discovering',
      current: 100,
      total: 100,
      message: `Found ${links.length} papers`,
      logs: addLog(logs, `✅ Found ${links.length} total PDF links`)
    });
    return links;
  } catch (error: any) {
    onProgress({
      phase: 'discovering',
      current: 0,
      total: 100,
      message: 'Failed to discover papers',
      logs: addLog(logs, `❌ Error: ${error.message}`)
    });
    throw error;
  }
}

export async function extractQuestions(
  subjectName: string,
  subjectCode: string,
  pairs: ExtractionPair[],
  onProgress: (progress: ExtractionProgress) => void
): Promise<ExtractionPair[]> {
  const results: ExtractionPair[] = [];
  const total = pairs.length;
  const logs: string[] = [];

  onProgress({
    phase: 'parsing',
    current: 0,
    total,
    message: 'Starting question extraction...',
    logs: addLog(logs, `📄 Starting extraction for ${total} paper pairs`)
  });

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const pairLogs = addLog(logs, `📄 Processing: ${pair.question_paper.name}`);
    
    onProgress({
      phase: 'parsing',
      current: i,
      total,
      message: `Processing ${pair.question_paper.name}...`,
      logs: pairLogs
    });

    try {
      if (!pair.marking_scheme) {
        results.push({ ...pair, error: 'No marking scheme found' });
        continue;
      }

      onProgress({
        phase: 'downloading',
        current: i,
        total,
        message: `Downloading PDFs for ${pair.question_paper.name}...`,
        logs: addLog(pairLogs, `   📥 Downloading PDFs...`)
      });

      const qpUrl = withCorsProxy(pair.question_paper.url);
      const msUrl = withCorsProxy(pair.marking_scheme.url);

      const qpText = await extractTextFromPDF(qpUrl);
      const msText = await extractTextFromPDF(msUrl);

      onProgress({
        phase: 'parsing',
        current: i,
        total,
        message: `Extracting questions from ${pair.question_paper.name}...`,
        logs: addLog(pairLogs, `   🧠 Parsing with AI...`)
      });

      const questions = await parsePastPaperQuestions(
        subjectName,
        subjectCode,
        qpText,
        msText
      );

      results.push({ ...pair, questions });
      onProgress({
        phase: 'parsing',
        current: i + 1,
        total,
        message: `Extracted ${questions.length} questions from ${pair.question_paper.name}`,
        logs: addLog(pairLogs, `   ✅ Extracted ${questions.length} questions`)
      });

    } catch (error: any) {
      results.push({ ...pair, error: error.message });
      onProgress({
        phase: 'parsing',
        current: i + 1,
        total,
        message: `Failed to process ${pair.question_paper.name}`,
        logs: addLog(pairLogs, `   ❌ Failed: ${error.message}`)
      });
    }
  }

  return results;
}

export async function runFullExtraction(
  subjectName: string,
  subjectCode: string,
  year: number,
  onProgress: (progress: ExtractionProgress) => void
): Promise<ExtractionPair[]> {
  const links = await discoverPapers(subjectCode, year, onProgress);
  
  const qps = links.filter(l => l.type === 'question_paper');
  const mss = links.filter(l => l.type === 'marking_scheme');
  
  const pairs: ExtractionPair[] = qps.map(qp => {
    const ms = mss.find(m => 
      m.session === qp.session && 
      m.paper_number === qp.paper_number
    );
    return { question_paper: qp, marking_scheme: ms! };
  }).filter(p => p.marking_scheme);

  return await extractQuestions(subjectName, subjectCode, pairs, onProgress);
}