import axios from 'axios';
import * as cheerio from 'cheerio';

export interface PaperLink {
  name: string;
  url: string;
  type: 'question_paper' | 'marking_scheme' | 'other';
  session: string;
  year: number;
  paper_number: string;
}

const BASE_URL = 'https://pastpapers.papacambridge.com/papers/caie';

/**
 * Maps subject names to the PapaCambridge URL slugs.
 * This is a partial map and might need expansion.
 */
const SUBJECT_SLUGS: Record<string, string> = {
  '0455': 'economics-0455',
  '0450': 'business-studies-0450',
  '0452': 'accounting-0452',
  '0500': 'english-first-language-0500',
  '0510': 'english-second-language-0510',
  '0580': 'mathematics-0580',
  '0610': 'biology-0610',
  '0620': 'chemistry-0620',
  '0478': 'computer-science-0478',
  '0625': 'physics-0625',
  '0460': 'geography-0460',
};

export async function findPaperLinks(subjectCode: string, year: number): Promise<PaperLink[]> {
  const slug = SUBJECT_SLUGS[subjectCode];
  if (!slug) throw new Error(`Unknown subject code: ${subjectCode}`);

  // Base URL for the subject
  const subjectUrl = `https://pastpapers.papacambridge.com/papers/caie/igcse-${slug}`;
  console.log(`Scraping subject index: ${subjectUrl}`);

  try {
    const { data } = await axios.get(subjectUrl);
    let $ = cheerio.load(data);
    const links: PaperLink[] = [];
    const sessionUrls: string[] = [];

    // Find links to year/session folders
    $('a').each((_, element) => {
      const href = $(element).attr('href') || '';
      const text = $(element).text().trim();
      
      // Look for links that contain the year (e.g., "2024" or "May June 2024")
      if (href.includes(year.toString()) || text.includes(year.toString())) {
        const fullUrl = href.startsWith('http') ? href : `https://pastpapers.papacambridge.com${href.startsWith('/') ? '' : '/papers/caie/'}${href}`;
        sessionUrls.push(fullUrl);
      }
    });

    console.log(`📅 Found ${sessionUrls.length} potential session directories for ${year}.`);

    // Scrape each session directory for PDFs
    for (const sUrl of sessionUrls) {
      console.log(`   📂 Scraping session: ${sUrl}`);
      try {
        const { data: sData } = await axios.get(sUrl);
        const $s = cheerio.load(sData);
        
        $s('.kt-widget4__item').each((_, row) => {
          const $row = $s(row);
          const nameText = $row.find('.kt-widget4__title span').text().trim().toLowerCase();
          const href = $row.find('a.badge-info').attr('href') || '';
          
          if (href && (href.endsWith('.pdf') || href.includes('files='))) {
            // Extract actual URL from download link if it's a query param
            let pdfUrl = href;
            if (href.includes('files=')) {
              pdfUrl = decodeURIComponent(href.split('files=')[1]);
            }
            if (!pdfUrl.startsWith('http')) pdfUrl = `https://pastpapers.papacambridge.com${pdfUrl.startsWith('/') ? '' : '/'}${pdfUrl}`;
            
            let type: PaperLink['type'] = 'other';
            if (nameText.includes('qp') || nameText.includes('question paper')) type = 'question_paper';
            else if (nameText.includes('ms') || nameText.includes('marking scheme') || nameText.includes('mark scheme')) type = 'marking_scheme';

            // Extract paper number (e.g., "11", "22")
            let paper_number = 'unknown';
            const numMatch = nameText.match(/(?:paper|ms|qp|scheme)\s*(\d+)/i) || nameText.match(/_(\d{2,3})/);
            if (numMatch) paper_number = numMatch[1];

            // Extract session from URL
            let session = 'unknown';
            if (sUrl.includes('march')) session = 'm';
            else if (sUrl.includes('may-june') || sUrl.includes('june')) session = 's';
            else if (sUrl.includes('oct-nov') || sUrl.includes('nov')) session = 'w';

            links.push({
              name: nameText,
              url: pdfUrl,
              type,
              session,
              year,
              paper_number
            });
          }
        });
      } catch (e) {
        console.warn(`      ⚠️  Failed to scrape session ${sUrl}`);
      }
    }

    return links;
  } catch (error) {
    console.error(`Failed to scrape PapaCambridge: ${error}`);
    return [];
  }
}

/**
 * Groups question papers with their corresponding marking schemes.
 */
export function linkPapers(links: PaperLink[]) {
  const qps = links.filter(l => l.type === 'question_paper');
  const mss = links.filter(l => l.type === 'marking_scheme');

  console.log(`Debug Linking: Found ${qps.length} QPs and ${mss.length} MSs.`);
  if (qps.length > 0) console.log(`Sample QP: ${qps[0].name} (Num: ${qps[0].paper_number}, Sess: ${qps[0].session})`);
  if (mss.length > 0) console.log(`Sample MS: ${mss[0].name} (Num: ${mss[0].paper_number}, Sess: ${mss[1]?.session})`);

  return qps.map(qp => {
    // Try to find a marking scheme with the same paper number and session
    const ms = mss.find(m => m.session === qp.session && m.paper_number === qp.paper_number);
    return {
      question_paper: qp,
      marking_scheme: ms,
    };
  });
}
