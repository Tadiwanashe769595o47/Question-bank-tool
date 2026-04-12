import React, { useState, useEffect } from "react";
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
  Database
} from "lucide-react";
import { cn } from "./lib/utils";
import { SUBJECTS } from "./constants";
import { Question, SyllabusConfirmation, QuestionBank, Subject } from "./types";
import { generateQuestionsBatch } from "./services/gemini";
import { pushQuestionsToSupabase, testSupabaseConnection, getExistingQuestionTexts, fetchHistory, HistoryRecord } from "./services/supabaseService";
import { History, Calendar } from "lucide-react";

export default function App() {
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationMessage, setGenerationMessage] = useState("");
  const [view, setView] = useState<'dashboard' | 'config' | 'generator' | 'viewer' | 'history'>('dashboard');
  const [questionCount, setQuestionCount] = useState(20);
  const [diagramType, setDiagramType] = useState('Auto');
  const [referenceImage, setReferenceImage] = useState<{data: string, mimeType: string} | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [saveMessage, setSaveMessage] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [currentStreamedQuestion, setCurrentStreamedQuestion] = useState("");
  const [isPushed, setIsPushed] = useState(false);
  
  // History state
  const [historyData, setHistoryData] = useState<HistoryRecord[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historySubjectFilter, setHistorySubjectFilter] = useState<string>('ALL');

  useEffect(() => {
    testSupabaseConnection().then(success => {
      setConnectionStatus(success ? 'connected' : 'error');
    });
  }, []);

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

  const handleSelectSubject = (subject: Subject) => {
    setSelectedSubject(subject);
    setView('config');
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

  const handleViewHistory = () => {
    setView('history');
    loadHistory();
  };

  const startGeneration = async () => {
    if (!selectedSubject) return;
    setView('generator');
    setIsGenerating(true);
    setIsPushed(false);
    setGenerationProgress(0);
    setGenerationMessage("Checking history to prevent duplicates...");
    setCurrentStreamedQuestion("");
    setQuestions([]);
    setIsPushed(false);

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
        { type: diagramType, referenceImage: referenceImage || undefined },
        existing,
        (currentQuestions) => {
          setQuestions([...currentQuestions]);
          setCurrentStreamedQuestion(""); // Reset streamed question when a batch completes
        },
        (partialText) => {
          setCurrentStreamedQuestion(partialText);
        }
      );
    } catch (error) {
      console.error("Generation failed", error);
      setGenerationMessage("An error occurred during generation.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePushToSupabase = async (questionsToPush?: Question[]) => {
    const targetQuestions = questionsToPush || questions;
    if (!selectedSubject || targetQuestions.length === 0) return;
    
    if (!import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
      alert("Please configure your Supabase Anon Key in the environment variables first.");
      return;
    }

    setIsSaving(true);
    setSaveProgress(0);
    setSaveMessage("Starting upload...");
    try {
      const result = await pushQuestionsToSupabase(targetQuestions, (progress, message) => {
        setSaveProgress(progress);
        setSaveMessage(message);
      });
      
      if (result.successCount === 0) {
        const errorMsg = result.errors[0]?.message || result.errors[0] || "Unknown error";
        throw new Error(`Failed to push any questions. Error: ${errorMsg}`);
      }

      setIsPushed(true);
      
      if (result.failedCount > 0) {
        setSaveMessage(`Pushed ${result.successCount} questions. ${result.failedCount} failed.`);
        alert(`Warning: ${result.failedCount} questions failed to push. Check console for details.`);
      } else {
        setSaveMessage("Successfully pushed all questions and diagrams to Supabase!");
        alert("Successfully pushed all questions and diagrams to Supabase!");
      }
    } catch (error: any) {
      console.error("Push failed", error);
      setSaveMessage("Failed to push to Supabase. Check console for details.");
      alert(`Failed to push to Supabase:\n${error.message || error}`);
    } finally {
      setIsSaving(false);
      setSaveProgress(100);
    }
  };

  const downloadJSON = () => {
    if (!selectedSubject) return;
    const exportData = {
      metadata: {
        version: "1.0",
        subject_code: selectedSubject.code,
        subject_name: selectedSubject.name,
        generated_date: new Date().toISOString().split('T')[0],
        total_questions: questions.length
      },
      questions: questions.map(q => {
        const { _raw_svg, id, ...rest } = q;
        return {
          subject_code: selectedSubject.code,
          ...rest
        };
      })
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IGCSE_${selectedSubject.code}_Bank.json`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-blue-100">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg">
            <BrainCircuit className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">IGCSE Research Agent</h1>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Cambridge 2027 Specialist</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={handleViewHistory}
            className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 rounded-full text-sm font-medium transition-colors shadow-sm"
          >
            <History className="w-4 h-4 text-gray-600" />
            View History
          </button>
          <div className={cn(
            "hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border",
            connectionStatus === 'connected' ? "bg-green-50 text-green-700 border-green-200" :
            connectionStatus === 'error' ? "bg-red-50 text-red-700 border-red-200" :
            "bg-gray-50 text-gray-700 border-gray-200"
          )}>
            <span className={cn(
              "w-2 h-2 rounded-full",
              connectionStatus === 'connected' ? "bg-green-500" :
              connectionStatus === 'error' ? "bg-red-500" :
              "bg-gray-500 animate-pulse"
            )} />
            {connectionStatus === 'connected' ? 'Supabase Connected' : 
             connectionStatus === 'error' ? 'Supabase Disconnected' : 'Checking Connection...'}
          </div>
          {selectedSubject && (
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-full text-sm font-medium">
              {selectedSubject.name} ({selectedSubject.code})
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        <AnimatePresence mode="wait">
          {view === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <section className="text-center max-w-2xl mx-auto space-y-4 py-12">
                <h2 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
                  Build Your Question Bank
                </h2>
                <p className="text-xl text-gray-600">
                  Select a subject to configure and generate high-quality, ESL-friendly assessment materials.
                </p>
              </section>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {SUBJECTS.map((subject) => (
                  <motion.button
                    key={subject.code}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleSelectSubject(subject)}
                    className="group relative bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:shadow-xl hover:border-blue-500 transition-all text-left"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="p-3 bg-blue-50 rounded-xl group-hover:bg-blue-600 transition-colors">
                        <BookOpen className="w-6 h-6 text-blue-600 group-hover:text-white" />
                      </div>
                      <span className="text-xs font-bold text-gray-400 group-hover:text-blue-500 transition-colors uppercase tracking-widest">
                        {subject.code}
                      </span>
                    </div>
                    <h3 className="text-xl font-bold mb-2">{subject.name}</h3>
                    <p className="text-sm text-gray-500 line-clamp-2 mb-4">
                      {subject.coveredTopics.length} topics covered in current semester.
                    </p>
                    <div className="flex items-center text-blue-600 font-semibold text-sm">
                      Start Research <ChevronRight className="w-4 h-4 ml-1" />
                    </div>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}

          {view === 'config' && selectedSubject && (
            <motion.div
              key="config"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-4xl mx-auto space-y-6"
            >
              <button 
                onClick={() => setView('dashboard')}
                className="flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard
              </button>

              <div className="bg-white rounded-3xl border border-gray-200 overflow-hidden shadow-lg">
                <div className="p-8 border-b border-gray-100 bg-gradient-to-br from-blue-50 to-white">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="p-3 bg-blue-600 rounded-2xl">
                      <Database className="w-8 h-8 text-white" />
                    </div>
                    <div>
                      <h2 className="text-3xl font-black tracking-tight">{selectedSubject.name}</h2>
                      <p className="text-gray-500 font-medium">Generation Configuration</p>
                    </div>
                  </div>
                </div>

                <div className="p-8 space-y-8">
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-2 p-4 bg-blue-50 rounded-2xl border border-blue-100">
                        <label className="text-sm font-bold text-blue-900 uppercase tracking-wider">Number of Questions:</label>
                        <select 
                          value={questionCount}
                          onChange={(e) => setQuestionCount(Number(e.target.value))}
                          className="bg-white border border-blue-200 rounded-lg px-3 py-2 text-sm font-bold text-blue-700 outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {[10, 20, 40, 60, 80, 100].map(n => (
                            <option key={n} value={n}>{n} Questions</option>
                          ))}
                        </select>
                      </div>
                      
                      <div className="flex flex-col gap-2 p-4 bg-blue-50 rounded-2xl border border-blue-100">
                        <label className="text-sm font-bold text-blue-900 uppercase tracking-wider">Diagram Type:</label>
                        <select 
                          value={diagramType}
                          onChange={(e) => setDiagramType(e.target.value)}
                          className="bg-white border border-blue-200 rounded-lg px-3 py-2 text-sm font-bold text-blue-700 outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="Auto">Auto (Let AI decide)</option>
                          <option value="Circuit Diagrams">Circuit Diagrams</option>
                          <option value="Chemical Structures">Chemical Structures</option>
                          <option value="Biological Cells/Systems">Biological Cells/Systems</option>
                          <option value="Graphs/Charts">Graphs/Charts</option>
                          <option value="Flowcharts">Flowcharts</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 p-4 bg-blue-50 rounded-2xl border border-blue-100">
                      <label className="text-sm font-bold text-blue-900 uppercase tracking-wider">Reference Sketch (Optional):</label>
                      <p className="text-xs text-blue-700 mb-1">Upload a rough sketch or image to be refined into SVG diagrams for the questions.</p>
                      <div className="flex items-center gap-4">
                        <input 
                          type="file" 
                          accept="image/*"
                          onChange={handleImageUpload}
                          className="text-sm text-blue-700 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200"
                        />
                        {referenceImage && <span className="text-xs text-green-600 font-bold flex items-center gap-1"><CheckCircle2 className="w-4 h-4"/> Image attached</span>}
                      </div>
                    </div>

                    <div className="flex justify-end pt-4">
                      <button
                        onClick={startGeneration}
                        className="px-8 py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all flex items-center gap-2"
                      >
                        <Plus className="w-5 h-5" /> Generate Question Bank
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'generator' && selectedSubject && (
            <motion.div
              key="generator"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="max-w-2xl mx-auto text-center space-y-8 py-20"
            >
              <div className="relative inline-block">
                <div className="absolute inset-0 bg-blue-400 blur-3xl opacity-20 animate-pulse rounded-full" />
                <div className="relative bg-white p-8 rounded-full shadow-2xl border border-gray-100">
                  {isGenerating ? (
                    <Loader2 className="w-16 h-16 text-blue-600 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-16 h-16 text-green-500" />
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <h2 className="text-3xl font-black tracking-tight">
                  {isGenerating ? "Generating Questions..." : "Generation Complete!"}
                </h2>
                <p className="text-gray-500 font-medium">
                  {isSaving ? saveMessage : (isGenerating 
                    ? generationMessage
                    : `Successfully generated ${questions.length} questions for your bank.`)}
                </p>
              </div>

              <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${isSaving ? saveProgress : generationProgress}%` }}
                  className="bg-blue-600 h-full rounded-full"
                />
              </div>

              {/* Real-time streaming of questions */}
              {(questions.length > 0 || currentStreamedQuestion) && (
                <div className="mt-8 space-y-4 text-left">
                  <h3 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-4">Generated So Far ({questions.length})</h3>
                  <div className="max-h-64 overflow-y-auto space-y-3 pr-2">
                    {questions.map((q, i) => (
                      <div key={i} className="p-4 bg-gray-50 rounded-xl border border-gray-100 animate-in fade-in slide-in-from-bottom-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-[10px] font-black uppercase">Q{i + 1}</span>
                          <span className="text-xs font-bold text-gray-400">{q.topic}</span>
                        </div>
                        <p className="text-sm font-medium text-gray-800 line-clamp-2">{q.question_text}</p>
                      </div>
                    ))}
                    
                    {/* Currently generating question */}
                    {currentStreamedQuestion && (
                      <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100 animate-pulse">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="px-2 py-1 bg-blue-200 text-blue-800 rounded text-[10px] font-black uppercase flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> Generating...
                          </span>
                        </div>
                        <p className="text-sm font-medium text-blue-900/70 italic">
                          {currentStreamedQuestion}
                          <span className="animate-ping ml-1">|</span>
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-center gap-4 pt-8">
                {!isGenerating && (
                  <>
                    <button
                      onClick={() => setView('viewer')}
                      className="px-6 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-bold hover:bg-gray-50 transition-all flex items-center gap-2"
                    >
                      <Eye className="w-5 h-5" /> Preview Questions
                    </button>
                    <button
                      onClick={handlePushToSupabase}
                      disabled={isSaving || isPushed}
                      className={cn(
                        "px-6 py-3 text-white rounded-xl font-bold shadow-lg transition-all flex items-center gap-2",
                        isPushed ? "bg-green-600 hover:bg-green-700 shadow-green-200" : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200"
                      )}
                    >
                      {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : (isPushed ? <CheckCircle2 className="w-5 h-5" /> : <Database className="w-5 h-5" />)}
                      {isSaving ? "Pushing to Supabase..." : (isPushed ? "Pushed Successfully" : "Push to Supabase")}
                    </button>
                    <button
                      onClick={downloadJSON}
                      className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all flex items-center gap-2"
                    >
                      <Download className="w-5 h-5" /> Download JSON
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          )}

          {view === 'viewer' && selectedSubject && (
            <motion.div
              key="viewer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <button 
                  onClick={() => setView('dashboard')}
                  className="flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={handlePushToSupabase}
                    disabled={isSaving || isPushed}
                    className={cn(
                      "px-4 py-2 text-white rounded-lg font-bold text-sm shadow-md transition-all flex items-center gap-2",
                      isPushed ? "bg-green-600 hover:bg-green-700" : "bg-indigo-600 hover:bg-indigo-700"
                    )}
                  >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : (isPushed ? <CheckCircle2 className="w-4 h-4" /> : <Database className="w-4 h-4" />)}
                    {isSaving ? "Pushing..." : (isPushed ? "Pushed" : "Push to Supabase")}
                  </button>
                  <button
                    onClick={downloadJSON}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold text-sm shadow-md hover:bg-blue-700 transition-all flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" /> Export Bank
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6">
                {questions.map((q, idx) => (
                  <div key={q.id || idx} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                      <div className="flex items-center gap-3">
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-[10px] font-black uppercase tracking-tighter">
                          Q{idx + 1}
                        </span>
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                          {q.topic} › {q.subtopic}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-xs font-bold text-gray-500">{q.marks} Marks</span>
                        <span className={cn(
                          "px-2 py-1 rounded text-[10px] font-bold uppercase",
                          q.difficulty > 3 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                        )}>
                          Level {q.difficulty}
                        </span>
                      </div>
                    </div>
                    
                    <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-12">
                      <div className="space-y-6">
                        <div className="prose prose-blue max-w-none">
                          <h3 className="text-xl font-bold text-gray-900 leading-relaxed">
                            {q.question_text}
                          </h3>
                        </div>

                        {q.options_json && (
                          <div className="grid grid-cols-1 gap-3">
                            {q.options_json.map((opt, i) => (
                              <div key={i} className={cn(
                                "p-4 rounded-xl border text-sm font-medium transition-all",
                                opt.startsWith(q.correct_answer) 
                                  ? "bg-green-50 border-green-200 text-green-800" 
                                  : "bg-white border-gray-100 text-gray-600"
                              )}>
                                {opt}
                              </div>
                            ))}
                          </div>
                        )}

                        {q._raw_svg && (
                          <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                            <div 
                              className="w-full min-h-[300px] flex items-center justify-center overflow-hidden [&>svg]:max-w-full [&>svg]:max-h-[500px] [&>svg]:h-auto"
                              dangerouslySetInnerHTML={{ __html: q._raw_svg }}
                            />
                          </div>
                        )}
                      </div>

                      <div className="space-y-6 border-l border-gray-100 pl-12">
                        <div className="space-y-4">
                          <h4 className="text-xs font-black uppercase tracking-widest text-blue-600">Model Answer</h4>
                          <div className="p-4 bg-blue-50 rounded-xl text-sm text-blue-900 font-medium leading-relaxed">
                            {q.model_answer}
                          </div>
                        </div>

                        <div className="space-y-4">
                          <h4 className="text-xs font-black uppercase tracking-widest text-gray-500">Explanation</h4>
                          <p className="text-sm text-gray-600 leading-relaxed">
                            {q.explanation_json.why_correct}
                          </p>
                          <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                            <span className="text-[10px] font-bold uppercase text-gray-400 block mb-1">Key Understanding</span>
                            <p className="text-sm text-gray-700">{q.explanation_json.key_understanding}</p>
                          </div>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {q.key_points_json && q.key_points_json.map((k, i) => (
                              <span key={i} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-[10px] font-bold">
                                {k}
                              </span>
                            ))}
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
            <motion.div
              key="history"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <button 
                  onClick={() => setView('dashboard')}
                  className="flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard
                </button>
                <h2 className="text-2xl font-black tracking-tight flex items-center gap-2">
                  <History className="w-6 h-6 text-blue-600" />
                  Generation History
                </h2>
              </div>

              <div className="bg-white rounded-3xl border border-gray-200 overflow-hidden shadow-lg p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <label className="text-sm font-bold text-gray-700">Filter by Subject:</label>
                    <select 
                      value={historySubjectFilter}
                      onChange={(e) => setHistorySubjectFilter(e.target.value)}
                      className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="ALL">All Subjects</option>
                      {SUBJECTS.map(s => (
                        <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
                      ))}
                    </select>
                  </div>
                  <button 
                    onClick={loadHistory}
                    className="text-sm font-bold text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    Refresh History
                  </button>
                </div>

                {isHistoryLoading ? (
                  <div className="flex flex-col items-center justify-center py-12 space-y-4">
                    <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
                    <p className="text-gray-500">Loading history from Supabase...</p>
                  </div>
                ) : historyData.length === 0 ? (
                  <div className="text-center py-12">
                    <Database className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500 font-medium">No history found. Generate and push some questions first!</p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {/* Group by date */}
                    {Object.entries(
                      historyData
                        .filter(record => historySubjectFilter === 'ALL' || record.subject_code === historySubjectFilter)
                        .reduce((acc, record) => {
                          const date = new Date(record.created_at).toLocaleDateString();
                          if (!acc[date]) acc[date] = [];
                          acc[date].push(record);
                          return acc;
                        }, {} as Record<string, HistoryRecord[]>)
                    ).map(([date, records]) => {
                      const typedRecords = records as HistoryRecord[];
                      return (
                      <div key={date} className="space-y-4">
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2 border-b pb-2">
                          <Calendar className="w-5 h-5 text-blue-500" />
                          {date}
                          <span className="text-xs font-medium bg-gray-100 text-gray-600 px-2 py-1 rounded-full ml-2">
                            {typedRecords.length} questions
                          </span>
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {typedRecords.map(record => (
                            <div key={record.id} className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                              <div className="flex items-center justify-between mb-2">
                                <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-[10px] font-black uppercase">
                                  {record.subject_code}
                                </span>
                                <span className="text-[10px] font-bold text-gray-400">
                                  {new Date(record.created_at).toLocaleTimeString()}
                                </span>
                              </div>
                              <p className="text-xs font-bold text-gray-500 mb-1">{record.topic} › {record.subtopic}</p>
                              <p className="text-sm font-medium text-gray-800 line-clamp-2">{record.question_text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )})}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="mt-20 border-t border-gray-200 bg-white p-12">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-3 opacity-50">
            <BrainCircuit className="w-5 h-5" />
            <span className="text-sm font-bold tracking-tighter uppercase">IGCSE Research Agent v1.0</span>
          </div>
          <div className="flex gap-8 text-sm font-medium text-gray-500">
            <a href="#" className="hover:text-blue-600 transition-colors">Syllabus Guide</a>
            <a href="#" className="hover:text-blue-600 transition-colors">ESL Standards</a>
            <a href="#" className="hover:text-blue-600 transition-colors">Marking Schemes</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
