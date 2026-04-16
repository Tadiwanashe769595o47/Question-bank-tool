import { supabase } from '../lib/supabase';
import { Question } from '../types';
import { SUBJECTS } from '../constants';
import { regenerateDiagramForQuestion } from './aiService';

// Environment-agnostic canvas and Image
let Canvas: any;
let Image: any;
let loadImage: any;

if (typeof window === 'undefined') {
  // Node.js environment - dynamic import because this is an ESM module
  import('canvas').then(canvasPkg => {
    Canvas = canvasPkg.Canvas;
    Image = canvasPkg.Image;
    loadImage = canvasPkg.loadImage;
  });
}

/**
 * Converts an SVG string to a PNG Blob.
 */
async function convertSvgToPngBlob(svgString: string): Promise<Blob | Buffer> {
  let cleanSvg = svgString;
  const svgMatch = cleanSvg.match(/<svg[\s\S]*<\/svg>/i);
  if (svgMatch) cleanSvg = svgMatch[0];

  if (typeof window === 'undefined') {
    // Node.js implementation using 'canvas' package
    const canvas = new Canvas(800, 600);
    const ctx = canvas.getContext('2d');
    const img = await loadImage(`data:image/svg+xml;base64,${Buffer.from(cleanSvg).toString('base64')}`);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 800, 600);
    ctx.drawImage(img, 0, 0, 800, 600);
    return canvas.toBuffer('image/png');
  } else {
    // Browser implementation
    return new Promise((resolve, reject) => {
      // ... (existing browser implementation)
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = canvas.getContext('2d');
      const img = new window.Image();
      const svgBlob = new Blob([cleanSvg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      img.onload = () => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 800, 600);
        ctx.drawImage(img, 0, 0, 800, 600);
        canvas.toBlob((blob) => resolve(blob!), 'image/png');
      };
      img.src = url;
    });
  }
}


/**
 * Uploads a diagram to Supabase Storage and returns the public URL.
 */
async function uploadDiagram(file: Blob, topic: string, subjectCode: string): Promise<string> {
  const topicSlug = topic.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const uuid = Math.random().toString(36).substring(2, 15);
  const fileName = `${subjectCode}/${topicSlug}-${uuid}.png`;
  
  console.log(`[Storage] Uploading diagram: diagrams/${fileName} (${Math.round(file.size / 1024)}KB)`);
  
  const { data, error } = await supabase.storage
    .from('diagrams')
    .upload(fileName, file, { upsert: false, contentType: 'image/png' });
  
  if (error) {
    // Expose full error details for debugging
    const errDetail = JSON.stringify({ message: error.message, name: (error as any).name, status: (error as any).status, statusCode: (error as any).statusCode });
    console.error('[Storage] Upload error:', errDetail);
    
    if (error.message?.includes('Bucket not found') || (error as any).statusCode === 404) {
      throw new Error(
        'Storage bucket "diagrams" not found. ' +
        'Go to Supabase Dashboard → Storage → New Bucket, create a PUBLIC bucket named "diagrams", ' +
        'then go to Authentication → Policies → Storage and add an INSERT policy for anon users.'
      );
    }
    if ((error as any).statusCode === 403 || error.message?.includes('policy') || error.message?.includes('security')) {
      throw new Error(
        'Storage upload blocked by RLS policy (403). ' +
        'Go to Supabase Dashboard → Authentication → Policies → Storage → diagrams bucket, ' +
        'and add a policy: Role = anon, Operation = INSERT, USING = true.'
      );
    }
    throw new Error(`Storage upload failed: ${error.message}`);
  }
  
  const { data: { publicUrl } } = supabase.storage
    .from('diagrams')
    .getPublicUrl(fileName);
  
  console.log(`[Storage] Upload success: ${publicUrl}`);
  return publicUrl;
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
 * Checks if the 'diagrams' storage bucket is accessible.
 * Returns 'ok' | 'bucket_missing' | 'policy_blocked' | 'unknown_error'
 */
export async function checkStorageBucket(): Promise<'ok' | 'bucket_missing' | 'policy_blocked' | 'unknown_error'> {
  try {
    // Try listing top-level items — this costs no money but confirms bucket access
    const { data, error } = await supabase.storage.from('diagrams').list('', { limit: 1 });
    if (!error) return 'ok';

    const statusCode = (error as any).statusCode;
    const msg = error.message || '';
    if (statusCode === 404 || msg.includes('Bucket not found') || msg.includes('not found')) return 'bucket_missing';
    if (statusCode === 403 || msg.includes('policy') || msg.includes('denied')) return 'policy_blocked';
    console.error('[Storage] checkStorageBucket error:', JSON.stringify(error));
    return 'unknown_error';
  } catch (e) {
    console.error('[Storage] checkStorageBucket threw:', e);
    return 'unknown_error';
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
  diagram_url: string | null;
}

/**
 * Fetches question history from Supabase.
 */
export async function fetchHistory(): Promise<HistoryRecord[]> {
  try {
    const { data, error } = await supabase
      .from('questions')
      .select('id, subject_code, topic, subtopic, created_at, difficulty, marks, question_text, diagram_url')
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Failed to fetch history:", err);
    return [];
  }
}

export async function updateQuestionDiagram(questionId: string, diagramUrl: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('questions')
      .update({ diagram_url: diagramUrl })
      .eq('id', questionId);
    
    if (error) throw error;
    return true;
  } catch (err) {
    console.error("Failed to update diagram:", err);
    return false;
  }
}

export async function convertSvgToPngAndUpload(svgString: string, topic: string, subjectCode: string): Promise<string | null> {
  try {
    const pngBlob = await convertSvgToPngBlob(svgString) as Blob;
    const url = await uploadDiagram(pngBlob, topic, subjectCode);
    return url;
  } catch (err) {
    console.error("Failed to convert and upload SVG:", err);
    return null;
  }
}

/**
 * Processes a batch of questions, uploading diagrams and inserting into Supabase.
 */
export async function pushQuestionsToSupabase(
  questions: Question[],
  onProgress?: (progress: number, message: string) => void
): Promise<{ successCount: number, failedCount: number, errors: any[], successfulIndices: number[], imageCount: number }> {
  console.log("Starting push to Supabase with", questions.length, "questions");
  let processedCount = 0;
  let failedCount = 0;
  let errors: any[] = [];
  let successfulIndices: number[] = [];
  let imageCount = 0;
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
      const questionText = q.question_text || '';
      const diagramType = q.diagram_type || 'None';
      
      const needsDiagram = (diagramType !== 'None' && diagramType !== 'null') || 
                           (questionText.toLowerCase().includes('diagram') || questionText.toLowerCase().includes('figure'));
      
      if (needsDiagram && !q._raw_svg && !finalDiagramUrl) {
        console.warn(`Missing SVG for question ${i + 1}. Attempting automatic regeneration...`);
        onProgress?.(
          Math.round(((i) / total) * 100),
          `Auto-recovering missing diagram for question ${i + 1}...`
        );
        try {
          q._raw_svg = await regenerateDiagramForQuestion(q);
        } catch (regenError: any) {
          console.warn(`Failed to auto-recover diagram for question ${i + 1}:`, regenError.message);
          // We swallow the error so that the question is pushed "no excuses", just without a diagram.
        }
      }

      // If there's a raw SVG, convert and upload it
      if (q._raw_svg && !finalDiagramUrl) {
        onProgress?.(
          Math.round(((i) / total) * 100),
          `Uploading diagram for question ${i + 1}...`
        );
        
        try {
          const pngBlob = await convertSvgToPngBlob(q._raw_svg) as Blob;
          finalDiagramUrl = await uploadDiagram(pngBlob, q.topic, q.subject_code || 'unknown');
          if (finalDiagramUrl) {
            imageCount++;
          }
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
          explanation_steps: q.explanation_steps,
          key_points_json: q.key_points_json,
          marks: q.marks != null ? Math.round(Number(q.marks)) : null,
          diagram_url: finalDiagramUrl || null,
          diagram_type: q.diagram_type || null,
          difficulty: q.difficulty != null ? Math.round(Number(q.difficulty)) : null,
          time_estimate: q.time_estimate != null ? Math.round(Number(q.time_estimate)) : null,
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

  console.log(`Push complete: ${processedCount} success, ${failedCount} failed, ${imageCount} images`);
  onProgress?.(100, `Saved ${processedCount} questions. ${failedCount} failed (check console).`);
  
  return { successCount: processedCount, failedCount, errors, successfulIndices, imageCount };
}
