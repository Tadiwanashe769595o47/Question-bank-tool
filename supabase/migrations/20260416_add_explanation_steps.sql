-- Migration: Add explanation_steps column to questions table
-- This column stores step-by-step explanations as a JSON array of strings.

ALTER TABLE questions 
ADD COLUMN IF NOT EXISTS explanation_steps JSONB DEFAULT '[]'::jsonb;

-- Recommended: Add a comment to the column for clarity
COMMENT ON COLUMN questions.explanation_steps IS 'Step-by-step explanation chunks for students, simplified for 3rd grade level.';
