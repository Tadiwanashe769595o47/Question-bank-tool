import { supabase } from '../lib/supabase';
import { Question } from '../types';
import { SUBJECTS } from '../constants';

/**
 * Converts an SVG string to a PNG Blob.
 */
async function convertSvgToPngBlob(svgString: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // Strip markdown formatting if AI provided it: e.g. ```xml <svg>... ```
    let cleanSvg = svgString;
    const match = cleanSvg.match(/<svg[\s\S]*<\/svg>/i);
    if (match) {
      cleanSvg = match[0];
    }

    // Critical fix: If the AI forgot the xmlns attribute, the browser Image element will silently fail to render the SVG!
    if (!cleanSvg.includes('xmlns=')) {
      cleanSvg = cleanSvg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return reject(new Error('Failed to get canvas context'));
    }

    const img = new Image();
    // Create a blob from the cleanly extracted SVG string
    const svgBlob = new Blob([cleanSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      // Set canvas dimensions to match image
      canvas.width = img.width || 800;
      canvas.height = img.height || 600;
      
      // Fill with white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw the SVG image
      ctx.drawImage(img, 0, 0);
      
      // Convert to PNG blob
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to convert canvas to blob'));
        }
      }, 'image/png');
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load SVG into image element'));
    };

    img.src = url;
  });
}

/**
 * Uploads a diagram to Supabase Storage and returns the public URL.
 */
async function uploadDiagram(file: Blob, topic: string, subjectCode: string): Promise<string> {
  const topicSlug = topic.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const uuid = Math.random().toString(36).substring(2, 15);
  const fileName = `${subjectCode}/${topicSlug}-${uuid}.png`;
  
  try {
    const { data, error } = await supabase.storage
      .from('diagrams')
      .upload(fileName, file, { upsert: false, contentType: 'image/png' });
    
    if (error) {
      if (error.message?.includes('fetch failed') || error.message?.includes('connect')) {
        throw new Error('Cannot connect to Supabase Storage. This may be a network/firewall issue, or the "diagrams" bucket may not exist. Please check: 1) Your firewall is not blocking storage.supabase.co, 2) The bucket "diagrams" exists in Supabase Dashboard -> Storage');
      }
      throw error;
    }
    
    const { data: { publicUrl } } = supabase.storage
      .from('diagrams')
      .getPublicUrl(fileName);
    
    return publicUrl;
  } catch (err: any) {
    if (err.message?.includes('Cannot connect to Supabase Storage')) {
      throw err;
    }
    throw new Error(`Storage upload failed: ${err.message}`);
  }
}

/**
 * Tests the connection to Supabase.
 */
export async function testSupabaseConnection(): Promise<boolean> {
  try {
    const { error } = await supabase.from('questions').select('id').limit(1);
    if (error) {
      // If the table doesn't exist or RLS blocks it, it still means we reached Supabase
      // but let's log it.
      console.warn("Supabase connection test returned an error (might be RLS or missing table):", error.message);
    }
    return true;
  } catch (err) {
    console.error("Supabase connection test failed:", err);
    return false;
  }
}

/**
 * Fetches recent questions to prevent duplicates.
 */
export async function getExistingQuestionTexts(subjectCode: string): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('questions')
      .select('question_text')
      .eq('subject_code', subjectCode)
      .order('created_at', { ascending: false })
      .limit(150);
      
    if (error) throw error;
    return data ? data.map(q => q.question_text) : [];
  } catch (err) {
    console.error("Failed to fetch existing questions:", err);
    return [];
  }
}

export interface HistoryRecord {
  id: string;
  subject_code: string;
  topic: string;
  subtopic: string;
  created_at: string;
  difficulty: number;
  marks: number;
  question_text: string;
}

/**
 * Fetches question history from Supabase.
 */
export async function fetchHistory(): Promise<HistoryRecord[]> {
  try {
    const { data, error } = await supabase
      .from('questions')
      .select('id, subject_code, topic, subtopic, created_at, difficulty, marks, question_text')
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Failed to fetch history:", err);
    return [];
  }
}

/**
 * Processes a batch of questions, uploading diagrams and inserting into Supabase.
 */
export async function pushQuestionsToSupabase(
  questions: Question[],
  onProgress?: (progress: number, message: string) => void
): Promise<{ successCount: number, failedCount: number, errors: any[], successfulIndices: number[] }> {
  console.log("Starting push to Supabase with", questions.length, "questions");
  let processedCount = 0;
  let failedCount = 0;
  let errors: any[] = [];
  let successfulIndices: number[] = [];
  const total = questions.length;

  if (total > 0) {
    const code = questions[0].subject_code;
    const subjectInfo = SUBJECTS.find(s => s.code === code);
    if (subjectInfo) {
      onProgress?.(0, `Ensuring subject ${code} exists in database...`);
      const { error: subjectError } = await supabase.from('subjects').upsert({
        code: subjectInfo.code,
        name: subjectInfo.name,
        icon: 'book',
        color: '#3B82F6'
      }, { onConflict: 'code' });
      
      if (subjectError) {
        console.warn(`Failed to auto-insert subject (might be RLS):`, subjectError);
      }
    }
  }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    console.log(`Processing question ${i + 1}:`, q.topic, q.subject_code);
    try {
      // DUPLICATE SAFETY: Before inserting, check whether a question already exists
      const { data: existing } = await supabase
        .from('questions')
        .select('id')
        .eq('subject_code', q.subject_code)
        .eq('topic', q.topic)
        .eq('question_text', q.question_text)
        .limit(1);

      if (existing && existing.length > 0) {
        console.log(`Skipping duplicate question: ${q.question_text.substring(0, 50)}...`);
        processedCount++;
        successfulIndices.push(i); // Count duplicates as "successful" so they get cleared from local drafts
        continue;
      }

      let finalDiagramUrl = q.diagram_url;

      // Pre-flight validation: Did the AI fail to generate a required diagram?
      const needsDiagram = (q.diagram_type && q.diagram_type !== 'None' && q.diagram_type !== 'null') || 
                           (q.question_text.toLowerCase().includes('diagram') || q.question_text.toLowerCase().includes('figure'));
      
      if (needsDiagram && !q._raw_svg && !finalDiagramUrl) {
        throw new Error("Missing SVG: This question requires a diagram, but the AI failed to generate the SVG code. Please regenerate the diagram.");
      }

      // If there's a raw SVG, convert and upload it
      if (q._raw_svg && !finalDiagramUrl) {
        onProgress?.(
          Math.round(((i) / total) * 100),
          `Uploading diagram for question ${i + 1}...`
        );
        
        try {
          const pngBlob = await convertSvgToPngBlob(q._raw_svg);
          finalDiagramUrl = await uploadDiagram(pngBlob, q.topic, q.subject_code || 'unknown');
        } catch (uploadErr: any) {
          console.warn(`Failed to upload diagram for question ${i + 1}, saving without diagram:`, uploadErr.message);
          finalDiagramUrl = null;
        }
      }

      onProgress?.(
        Math.round(((i) / total) * 100),
        `Saving question ${i + 1} to database...`
      );

      const { error } = await supabase
        .from('questions')
        .insert({
          subject_code: q.subject_code,
          topic: q.topic,
          subtopic: q.subtopic,
          question_text: q.question_text,
          question_type: q.question_type,
          options_json: q.options_json,
          correct_answer: q.correct_answer,
          model_answer: q.model_answer,
          explanation_json: q.explanation_json,
          key_points_json: q.key_points_json,
          marks: q.marks,
          diagram_url: finalDiagramUrl || null,
          diagram_type: q.diagram_type || null,
          difficulty: q.difficulty,
          time_estimate: q.time_estimate,
          source: 'research-agent'
        });
      
      if (error) {
        let errorMessage = error.message;
        if (error.details) errorMessage += ` (Details: ${error.details})`;
        if (error.hint) errorMessage += ` (Hint: ${error.hint})`;
        
        if (errorMessage.includes('row-level security policy')) {
          errorMessage = 'Row-Level Security (RLS) policy is blocking inserts. Please go to your Supabase Dashboard -> Authentication -> Policies, and create a policy that allows inserts for the "questions" table (e.g., "Enable insert for authenticated users only" or "Enable insert for all users" for testing).';
        }
        if (errorMessage.includes('null value') && errorMessage.includes('violates not-null')) {
          errorMessage = `Database NOT NULL constraint error: ${errorMessage}. Check that model_answer and explanation_json are provided for each question.`;
        }
        if (errorMessage.includes('foreign key') && errorMessage.includes('subject_code')) {
          errorMessage = `Foreign key violation for subject_code: "${q.subject_code}". \n\nI tried to automatically add this subject to the "subjects" table, but your Supabase RLS policies blocked it. Please go to Supabase -> Authentication -> Policies, and create a policy that enables "INSERT" for anonymous users on the "subjects" table!`;
        }
        console.error('Error inserting question:', errorMessage);
        throw new Error(errorMessage);
      }

      processedCount++;
      successfulIndices.push(i);
    } catch (err: any) {
      let errorMessage = err?.message;
      if (!errorMessage || errorMessage === 'Unknown error' || errorMessage === '[object Object]') {
        try {
          errorMessage = typeof err === 'object' ? JSON.stringify(err) : String(err);
        } catch (e) {
          errorMessage = String(err);
        }
      }
      console.error(`Question ${i + 1} failed:`, err);
      if (errorMessage.includes('Bucket not found')) {
        errorMessage = 'Storage bucket "diagrams" not found. Please go to your Supabase Dashboard -> Storage, and create a new public bucket named "diagrams".';
      }
      console.error(`Failed to process question ${i + 1}:`, err);
      failedCount++;
      errors.push(new Error(errorMessage));
    }
  }

  console.log(`Push complete: ${processedCount} success, ${failedCount} failed`);
  onProgress?.(100, `Saved ${processedCount} questions. ${failedCount} failed (check console).`);
  
  return { successCount: processedCount, failedCount, errors, successfulIndices };
}
