export type QuestionType = 
  | 'multiple_choice_single' 
  | 'multiple_choice_multiple' 
  | 'open_text' 
  | 'fill_blank' 
  | 'matching' 
  | 'ordering' 
  | 'labeling_diagram' 
  | 'table_completion' 
  | 'numerical'
  | 'essay'
  | 'spelling';

export interface Question {
  id?: string;
  subject_code?: string;
  topic: string;
  subtopic: string;
  question_text: string;
  question_type: string;
  options_json?: string[] | null;
  correct_answer: string;
  model_answer: string;
  explanation_json: {
    why_correct: string;
    key_understanding: string;
    [key: string]: any;
  };
  key_points_json: string[];
  marks: number;
  diagram_url?: string;
  diagram_type?: string;
  difficulty: number;
  time_estimate: number;
  source?: string;
  version?: number;
  client_temp_id?: string; // Internal use only, for tracking during ingestion
  _raw_svg?: string; // Internal use only, for rendering in preview
}

export interface Subject {
  code: string;
  name: string;
  coveredTopics: string[];
}

export interface SyllabusConfirmation {
  subject: string;
  code: string;
  verified: boolean;
  topics_matched: string[];
  gaps_identified: string[];
  recommendations: string[];
}

export interface QuestionBank {
  metadata: {
    version: string;
    subject_code: string;
    subject_name: string;
    generated_date: string;
    total_questions: number;
  };
  questions: Question[];
}

export interface Draft {
  id: string;
  subjectCode: string;
  subjectName: string;
  date: string;
  questions: Question[];
}
