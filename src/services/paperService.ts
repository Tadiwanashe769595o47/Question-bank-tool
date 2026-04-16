import axios from 'axios';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// For Node.js environment, we need to specify the worker
if (typeof window === 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
}

export async function extractTextFromPDF(pdfUrl: string): Promise<string> {
  try {
    const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
    const data = new Uint8Array(response.data);
    
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf = await loadingTask.promise;
    
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      
      fullText += `--- Page ${i} ---\n${pageText}\n\n`;
    }
    
    return fullText;
  } catch (error) {
    console.error(`Error extracting text from PDF (${pdfUrl}):`, error);
    throw error;
  }
}

/**
 * Extracts images from a specific page of a PDF.
 * This is a simplified version; real-world usage might need layout analysis.
 */
export async function extractImagesFromPDF(pdfUrl: string, pageNumber: number): Promise<string[]> {
  // TODO: Implement image extraction using canvas rendering or operator list traversal
  // For now, we will rely on Gemini Vision if we can send the whole page as an image.
  return [];
}
