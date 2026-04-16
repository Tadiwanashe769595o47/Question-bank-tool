import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  BookOpen, 
  CheckCircle2, 
  AlertCircle, 
  Download, 
  Plus, 
  ChevronRight, 
  Loader2, 
  BrainCircuit,
  ArrowLeft,
  Eye,
  Settings,
  Database,
  Save,
  Pencil,
  Trash2,
  RefreshCw,
  FileText,
  Clock
} from "lucide-react";
import { cn } from "./lib/utils";
import { SUBJECTS } from "./constants";
import { Question, SyllabusConfirmation, QuestionBank, Subject, Draft } from "./types";
import { generateQuestionsBatch, regenerateDiagramForQuestion } from "./services/aiService";
import { 
  pushQuestionsToSupabase, 
  testSupabaseConnection, 
  getExistingQuestionTexts, 
  fetchHistory, 
  HistoryRecord, 
  checkStorageBucket, 
  updateQuestionDiagram, 
  convertSvgToPngAndUpload 
} from "./services/supabaseService";
import { runFullExtraction, ExtractionProgress, ExtractionPair } from "./services/extractionService";
import MathText from "./components/MathText";

export default function App() {
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationMessage, setGenerationMessage] = useState("");
  const [view, setView] = useState<'dashboard' | 'config' | 'generator' | 'viewer' | 'history' | 'drafts' | 'extraction'>('dashboard');
  const [questionCount, setQuestionCount] = useState(20);
  const [diagramType, setDiagramType] = useState('Auto');
  const [referenceImage, setReferenceImage] = useState<{data: string, mimeType: string} | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [saveMessage, setSaveMessage] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [currentStreamedQuestion, setCurrentStreamedQuestion] = useState("");
  const [isPushed, setIsPushed] = useState(false);
  
  // Drafts state
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [editingQuestion, setEditingQuestion] = useState<{index: number; question: Question} | null>(null);
  
  // History state
  const [historyData, setHistoryData] = useState<HistoryRecord[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historySubjectFilter, setHistorySubjectFilter] = useState<string>('ALL');

  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);

  // Abort controller for terminating generation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Storage bucket health status
  const [storageStatus, setStorageStatus] = useState<'checking' | 'ok' | 'bucket_missing' | 'policy_blocked' | 'unknown_error'>('checking');

  // Extraction state
  const [extractionSubject, setExtractionSubject] = useState<string>('');
  const [extractionYear, setExtractionYear] = useState<number>(2024);
  const [extractionProgress, setExtractionProgress] = useState<ExtractionProgress | null>(null);
  const [extractionResults, setExtractionResults] = useState<ExtractionPair[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionMode, setExtractionMode] = useState<'discover' | 'extract' | 'review'>('discover');

  useEffect(() => {
    testSupabaseConnection().then(success => {
      setConnectionStatus(success ? 'connected' : 'error');
    });
    checkStorageBucket().then(status => setStorageStatus(status));
    
    // Load drafts from local storage
    const savedDrafts = localStorage.getItem('question_drafts');
    if (savedDrafts) {
      try {
        setDrafts(JSON.parse(savedDrafts));
      } catch (e) {
        console.error("Failed to parse drafts", e);
      }
    }
  }, []);

  const saveDraftsCollection = (updatedDrafts: Draft[]) => {
    setDrafts(updatedDrafts);
    localStorage.setItem('question_drafts', JSON.stringify(updatedDrafts));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      setReferenceImage({
        data: base64String,
        mimeType: file.type
      });
    };
    reader.readAsDataURL(file);
  };

  const loadHistory = async () => {
    setIsHistoryLoading(true);
    try {
      const data = await fetchHistory();
      setHistoryData(data);
    } catch (error) {
      console.error("Failed to load history", error);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const handleRegenerateDiagram = async (index: number, question: Question) => {
    setRegeneratingIndex(index);
    try {
      const newSvg = await regenerateDiagramForQuestion(question);
      const newQuestions = [...questions];
      newQuestions[index] = { ...newQuestions[index], _raw_svg: newSvg };
      setQuestions(newQuestions);
      alert("Diagram regenerated successfully!");
    } catch (err: any) {
      alert("Failed to regenerate diagram: " + (err.message || String(err)));
    } finally {
      setRegeneratingIndex(null);
    }
  };

  const startGeneration = async () => {
    if (!selectedSubject) return;
    setView('generator');
    setIsGenerating(true);
    setIsPushed(false);
    setGenerationProgress(0);
    setGenerationMessage("Connecting to AI providers...");
    setQuestions([]);

    try {
      const existing = await getExistingQuestionTexts(selectedSubject.code);

      const generatedQuestions = await generateQuestionsBatch(
        selectedSubject.name,
        selectedSubject.code,
        selectedSubject.coveredTopics,
        questionCount,
        'covered',
        (progress, message) => {
          setGenerationProgress(progress);
          setGenerationMessage(message);
        },
        { type: diagramType },
        existing,
        (currentQuestions) => {
          setQuestions([...currentQuestions]);
        }
      );
      
      if (generatedQuestions && generatedQuestions.length > 0) {
        const newDraft: Draft = {
          id: Date.now().toString(),
          subjectCode: selectedSubject.code,
          subjectName: selectedSubject.name,
          date: new Date().toISOString(),
          questions: generatedQuestions
        };
        saveDraftsCollection([newDraft, ...drafts]);
      }
      
    } catch (error: any) {
      console.error("Generation failed", error);
      setGenerationMessage(`Error: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePushToSupabase = async (questionsToPush?: Question[]) => {
    const targetQuestions = Array.isArray(questionsToPush) ? questionsToPush : questions;
    
    if (!selectedSubject || targetQuestions.length === 0) {
      alert("No questions to push");
      return;
    }

    setIsSaving(true);
    setSaveProgress(0);
    setSaveMessage("Uploading to Supabase...");
    try {
      const result = await pushQuestionsToSupabase(targetQuestions, (progress, message) => {
        setSaveProgress(progress);
        setSaveMessage(message);
      });
      
      if (result.successCount > 0) {
        setIsPushed(true);
        alert(`Successfully pushed ${result.successCount} questions!`);
        if (!questionsToPush) setQuestions([]);
      }
    } catch (error: any) {
      alert(`Push failed: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const saveDraft = () => {
    if (!selectedSubject || questions.length === 0) return;
    const newDraft: Draft = {
      id: Date.now().toString(),
      subjectCode: selectedSubject.code,
      subjectName: selectedSubject.name,
      date: new Date().toISOString(),
      questions: questions
    };
    saveDraftsCollection([newDraft, ...drafts]);
    alert("Saved to drafts!");
  };

  const loadDraft = (draft: Draft) => {
    const subject = SUBJECTS.find(s => s.code === draft.subjectCode);
    if (subject) {
      setSelectedSubject(subject);
      setQuestions(draft.questions);
      setView('viewer');
      setIsPushed(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-blue-100">
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg">
            <BrainCircuit className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Focused Scholar V3</h1>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">AI Question Bank Tool</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button onClick={() => { setView('history'); loadHistory(); }} className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-sm font-medium transition-colors">
            <Clock className="w-4 h-4" /> History
          </button>
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border bg-green-50 text-green-700 border-green-200">
            <span className="w-2 h-2 rounded-full bg-green-500" /> Supabase Connected
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        <AnimatePresence mode="wait">
          {view === 'dashboard' && (
            <motion.div key="dashboard" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-8">
              <section className="text-center max-w-2xl mx-auto space-y-4 py-12">
                <h2 className="text-4xl font-extrabold tracking-tight text-gray-900">Build Your Question Bank</h2>
                <p className="text-xl text-gray-600">Premium IGCSE content powered by NVIDIA Qwen 2.5 & OpenAI.</p>
              </section>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {SUBJECTS.map((subject) => (
                  <button key={subject.code} onClick={() => { setSelectedSubject(subject); setView('config'); }} className="group bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:shadow-xl hover:border-blue-500 transition-all text-left">
                    <div className="flex justify-between items-start mb-4">
                      <div className="p-3 bg-blue-50 rounded-xl group-hover:bg-blue-600 transition-colors">
                        <BookOpen className="w-6 h-6 text-blue-600 group-hover:text-white" />
                      </div>
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">{subject.code}</span>
                    </div>
                    <h3 className="text-xl font-bold mb-2">{subject.name}</h3>
                    <div className="flex items-center text-blue-600 font-semibold text-sm">Configure <ChevronRight className="w-4 h-4 ml-1" /></div>
                  </button>
                ))}
              </div>

              <div className="border-t border-gray-200 pt-8">
                <button onClick={() => setView('extraction')} className="w-full bg-gradient-to-r from-green-500 to-emerald-600 p-6 rounded-2xl border border-green-200 shadow-sm hover:shadow-xl transition-all text-left group">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <FileText className="w-6 h-6 text-green-600" />
                        <h3 className="text-xl font-bold text-gray-900">Extract Past Papers</h3>
                      </div>
                      <p className="text-sm text-gray-600">Pull authentic IGCSE questions from PapaCambridge archives</p>
                    </div>
                    <ChevronRight className="w-6 h-6 text-green-600 group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>
              </div>

              {drafts.length > 0 && (
                <div className="mt-16">
                  <h2 className="text-2xl font-black mb-6">Saved Drafts</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {drafts.map(draft => (
                      <div key={draft.id} onClick={() => loadDraft(draft)} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all cursor-pointer">
                        <h3 className="text-lg font-bold">{draft.subjectName}</h3>
                        <p className="text-sm text-gray-500">{draft.questions.length} questions</p>
                        <p className="text-xs text-gray-400 mt-2">{new Date(draft.date).toLocaleDateString()}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {view === 'config' && selectedSubject && (
            <motion.div key="config" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="max-w-4xl mx-auto space-y-6">
              <button onClick={() => setView('dashboard')} className="flex items-center text-sm font-medium text-gray-500"><ArrowLeft className="w-4 h-4 mr-2" /> Back</button>
              <div className="bg-white rounded-3xl border border-gray-200 p-8 shadow-lg">
                <h2 className="text-3xl font-black mb-8">{selectedSubject.name} Configuration</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-700 uppercase">Question Count</label>
                    <select value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-bold">
                      {[5, 10, 20, 50].map(n => <option key={n} value={n}>{n} Questions</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-700 uppercase">Diagram Type</label>
                    <select value={diagramType} onChange={(e) => setDiagramType(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-bold">
                      <option value="Auto">Auto</option>
                      <option value="Circuit">Circuit</option>
                      <option value="Graph">Graph</option>
                    </select>
                  </div>
                </div>
                <button onClick={startGeneration} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg hover:bg-blue-700 transition-all flex items-center justify-center gap-2">
                  <Plus className="w-5 h-5" /> Start AI Generation
                </button>
              </div>
            </motion.div>
          )}

          {view === 'generator' && (
            <motion.div key="generator" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-xl mx-auto text-center py-20 space-y-8">
              <div className="relative inline-block">
                <div className="bg-white p-8 rounded-full shadow-2xl border border-gray-100">
                  {isGenerating ? <Loader2 className="w-16 h-16 text-blue-600 animate-spin" /> : <CheckCircle2 className="w-16 h-16 text-green-500" />}
                </div>
              </div>
              <h2 className="text-3xl font-black">{isGenerating ? "AI is Working..." : "Content Ready!"}</h2>
              <p className="text-gray-500 font-medium">{generationMessage}</p>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <motion.div animate={{ width: `${generationProgress}%` }} className="bg-blue-600 h-full" />
              </div>
              {!isGenerating && questions.length > 0 && (
                <div className="flex flex-col gap-3">
                  <button onClick={() => setView('viewer')} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold">Preview Questions</button>
                  <button onClick={() => setView('dashboard')} className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold">Return to Dashboard</button>
                </div>
              )}
            </motion.div>
          )}

          {view === 'viewer' && (
            <motion.div key="viewer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
              <div className="flex items-center justify-between sticky top-[80px] z-40 bg-[#F8F9FA]/90 backdrop-blur-sm py-4">
                <button onClick={() => setView('dashboard')} className="flex items-center text-sm font-medium text-gray-500"><ArrowLeft className="w-4 h-4 mr-2" /> Back</button>
                <div className="flex gap-3">
                  <button onClick={saveDraft} className="px-6 py-2 bg-amber-500 text-white rounded-xl font-bold shadow-sm">Save Draft</button>
                  <button onClick={() => handlePushToSupabase()} disabled={isSaving || isPushed} className={cn("px-6 py-2 text-white rounded-xl font-bold shadow-sm transition-all", isPushed ? "bg-green-600" : "bg-indigo-600")}>
                    {isSaving ? "Pushing..." : (isPushed ? "Pushed" : "Push to Supabase")}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-8">
                {questions.map((q, idx) => (
                  <div key={idx} className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4">
                    <div className="p-6 bg-gray-50/50 border-b border-gray-100 flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-gray-400">
                      <span>Question {idx + 1} › {q.topic}</span>
                      <span className="bg-white px-2 py-1 rounded border border-gray-200 text-gray-600">{q.marks} Marks</span>
                    </div>
                    <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-12">
                      <div className="space-y-6">
                        <div className="prose prose-blue max-w-none">
                          <h3 className="text-xl font-bold text-gray-900 leading-relaxed"><MathText text={q.question_text} /></h3>
                        </div>
                        {q.options_json && (
                          <div className="grid grid-cols-1 gap-3">
                            {q.options_json.map((opt, i) => (
                              <div key={i} className={cn("p-4 rounded-xl border text-sm font-medium transition-all", opt.startsWith(q.correct_answer) ? "bg-green-50 border-green-200 text-green-800" : "bg-white border-gray-100 text-gray-600")}>
                                <MathText text={opt} />
                              </div>
                            ))}
                          </div>
                        )}
                        {q._raw_svg && (
                          <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col items-center">
                            <div className="w-full min-h-[200px] flex items-center justify-center [&>svg]:max-w-full" dangerouslySetInnerHTML={{ __html: q._raw_svg }} />
                            <button onClick={() => handleRegenerateDiagram(idx, q)} className="mt-4 px-4 py-2 bg-white border border-gray-200 text-xs font-bold rounded-lg flex items-center gap-2">
                              {regeneratingIndex === idx ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Regenerate Image
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="space-y-8 border-l border-gray-100 pl-12">
                        <div className="space-y-4">
                          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">Model Answer</h4>
                          <div className="p-5 bg-blue-50/50 rounded-2xl text-sm text-blue-900 font-semibold leading-relaxed border border-blue-100">
                            <MathText text={q.model_answer} />
                          </div>
                        </div>

                        <div className="space-y-4">
                          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Step-by-Step Explanation</h4>
                          {q.explanation_steps && q.explanation_steps.length > 0 ? (
                            <div className="space-y-4">
                              {q.explanation_steps.map((step, sIdx) => (
                                <div key={sIdx} className="flex gap-4 group">
                                  <div className="shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-[10px] font-black">
                                    {sIdx + 1}
                                  </div>
                                  <p className="text-sm text-gray-600 leading-relaxed pt-0.5"><MathText text={step} /></p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-600 leading-relaxed"><MathText text={q.explanation_json?.why_correct || ''} /></p>
                          )}
                          <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 italic">
                            <p className="text-xs text-gray-400 font-medium">
                              <span className="font-bold text-gray-500 uppercase tracking-tighter mr-2">Simple Principle:</span>
                              <MathText text={q.explanation_json?.key_understanding || ''} />
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {view === 'history' && (
            <motion.div key="history" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <button onClick={() => setView('dashboard')} className="flex items-center text-sm font-medium text-gray-500"><ArrowLeft className="w-4 h-4 mr-2" /> Back</button>
              <h2 className="text-3xl font-black">Generation History</h2>
              {isHistoryLoading ? <Loader2 className="w-8 h-8 animate-spin mx-auto" /> : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {historyData.map(record => (
                    <div key={record.id} className="p-6 bg-white rounded-2xl border border-gray-200 shadow-sm">
                      <div className="flex justify-between items-start mb-4">
                        <span className="px-2 py-1 bg-blue-100 text-blue-600 rounded text-[10px] font-black uppercase">{record.subject_code}</span>
                        <span className="text-[10px] font-bold text-gray-400">{new Date(record.created_at).toLocaleDateString()}</span>
                      </div>
                      <p className="font-bold mb-2">{record.topic}</p>
                      <p className="text-sm text-gray-500 line-clamp-2">{record.question_text}</p>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {view === 'extraction' && (
            <motion.div key="extraction" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <button onClick={() => { setView('dashboard'); setExtractionProgress(null); }} className="flex items-center text-sm font-medium text-gray-500"><ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard</button>
              <h2 className="text-3xl font-black">Past Paper Extraction</h2>
              
              {!isExtracting && extractionMode === 'discover' && (
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4 max-w-xl">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Subject</label>
                    <select 
                      value={extractionSubject} 
                      onChange={(e) => setExtractionSubject(e.target.value)}
                      className="w-full p-3 border border-gray-200 rounded-xl"
                    >
                      <option value="">Select Subject</option>
                      {SUBJECTS.map(s => (
                        <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Year</label>
                    <select 
                      value={extractionYear} 
                      onChange={(e) => setExtractionYear(parseInt(e.target.value))}
                      className="w-full p-3 border border-gray-200 rounded-xl"
                    >
                      {[2025, 2024, 2023, 2022, 2021, 2020].map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                  <button 
                    onClick={async () => {
                      if (!extractionSubject) return;
                      const subject = SUBJECTS.find(s => s.code === extractionSubject);
                      if (!subject) return;
                      
                      setIsExtracting(true);
                      setExtractionMode('extract');
                      
                      try {
                        const results = await runFullExtraction(
                          subject.name,
                          extractionSubject,
                          extractionYear,
                          (progress) => {
                            setExtractionProgress(progress);
                            setExtractionResults(prev => {
                              if (progress.phase === 'complete') {
                                setExtractionMode('review');
                              }
                              return prev;
                            });
                          }
                        );
                        setExtractionResults(results);
                        setExtractionMode('review');
                      } catch (err) {
                        console.error('Extraction failed:', err);
                      } finally {
                        setIsExtracting(false);
                      }
                    }}
                    disabled={!extractionSubject}
                    className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50"
                  >
                    Start Extraction
                  </button>
                </div>
              )}

              {isExtracting && extractionProgress && (
                <div className="bg-gray-900 text-green-400 p-6 rounded-2xl font-mono text-sm max-h-96 overflow-y-auto">
                  <div className="mb-4">
                    <span className="text-blue-400">{extractionProgress.message}</span>
                  </div>
                  {extractionProgress.logs.slice(-20).map((log, i) => (
                    <div key={i} className="opacity-80">{log}</div>
                  ))}
                  {extractionProgress.phase !== 'complete' && (
                    <div className="mt-4">
                      <div className="w-full bg-gray-700 rounded-full h-2">
                        <div 
                          className="bg-blue-500 h-2 rounded-full transition-all" 
                          style={{ width: `${(extractionProgress.current / Math.max(extractionProgress.total, 1)) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {extractionMode === 'review' && extractionResults.length > 0 && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold">Review Extracted Questions</h3>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          const allQuestions = extractionResults.flatMap(r => r.questions || []);
                          pushQuestionsToSupabase(allQuestions, (p, m) => console.log(p, m))
                            .then(() => {
                              alert('Questions pushed to Supabase!');
                              setView('dashboard');
                            });
                        }}
                        className="px-4 py-2 bg-green-600 text-white font-bold rounded-xl"
                      >
                        Push All to Database
                      </button>
                      <button 
                        onClick={() => { setView('dashboard'); setExtractionResults([]); setExtractionMode('discover'); }}
                        className="px-4 py-2 bg-gray-200 text-gray-700 font-bold rounded-xl"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  <div className="text-sm text-gray-600">
                    Total: {extractionResults.reduce((acc, r) => acc + (r.questions?.length || 0), 0)} questions from {extractionResults.length} papers
                  </div>
                  <div className="space-y-4 max-h-[500px] overflow-y-auto">
                    {extractionResults.map((pair, idx) => (
                      <div key={idx} className="bg-white p-4 rounded-xl border border-gray-200">
                        <h4 className="font-bold text-gray-800">{pair.question_paper.name}</h4>
                        <p className="text-sm text-gray-500">{pair.questions?.length || 0} questions extracted</p>
                        {pair.error && <p className="text-red-500 text-sm">{pair.error}</p>}
                        {pair.questions && pair.questions.length > 0 && (
                          <div className="mt-2 space-y-2">
                            {pair.questions.slice(0, 2).map((q, qIdx) => (
                              <div key={qIdx} className="text-xs text-gray-600 bg-gray-50 p-2 rounded">
                                <p className="font-medium">{q.question_text.substring(0, 100)}...</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
