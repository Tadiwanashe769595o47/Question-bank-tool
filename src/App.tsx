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
  Database,
  Save,
  Pencil,
  Trash2,
  RefreshCw
} from "lucide-react";
import { cn } from "./lib/utils";
import { SUBJECTS } from "./constants";
import { Question, SyllabusConfirmation, QuestionBank, Subject, Draft } from "./types";
import { generateQuestionsBatch, regenerateDiagramForQuestion } from "./services/gemini";
import { pushQuestionsToSupabase, testSupabaseConnection, getExistingQuestionTexts, fetchHistory, HistoryRecord } from "./services/supabaseService";
import { History, Calendar } from "lucide-react";

export default function App() {
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationMessage, setGenerationMessage] = useState("");
  const [view, setView] = useState<'dashboard' | 'config' | 'generator' | 'viewer' | 'history' | 'drafts'>('dashboard');
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

  // Regeneration state
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);

  useEffect(() => {
    testSupabaseConnection().then(success => {
      setConnectionStatus(success ? 'connected' : 'error');
    });
    
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

  const saveDrafts = (updatedDrafts: Draft[]) => {
    setDrafts(updatedDrafts);
    localStorage.setItem('question_drafts', JSON.stringify(updatedDrafts));
  };

  const clearDrafts = () => {
    setDrafts([]);
    localStorage.removeItem('question_drafts');
  };

  const importQuestions = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        const importedQuestions = data.questions || data;
        
        // Wrap imported questions in a Draft if needed
        if (Array.isArray(importedQuestions)) {
          const newDraft: Draft = {
            id: Date.now().toString(),
            subjectCode: selectedSubject?.code || 'unknown',
            subjectName: selectedSubject?.name || 'Imported Questions',
            date: new Date().toISOString(),
            questions: importedQuestions
          };
          const newDrafts = [newDraft, ...drafts];
          saveDrafts(newDrafts);
          alert(`Imported ${importedQuestions.length} questions to drafts!`);
        } else {
          alert('Invalid file format. Expected a JSON array of questions.');
        }
      } catch (err) {
        alert('Failed to parse file: ' + err);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
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

  const handleRegenerateDiagram = async (index: number, question: Question) => {
    setRegeneratingIndex(index);
    try {
      const newSvg = await regenerateDiagramForQuestion(question);
      
      // Update in active questions list if present
      const newQuestions = [...questions];
      if (newQuestions[index]?.question_text === question.question_text) {
        newQuestions[index] = { ...newQuestions[index], _raw_svg: newSvg };
        setQuestions(newQuestions);
      }
      
      // Update in drafts sessions if this question exists in any of them
      const newDrafts = drafts.map(draft => {
        const qIndex = draft.questions.findIndex(q => q.question_text === question.question_text);
        if (qIndex !== -1) {
          const updatedQuestions = [...draft.questions];
          updatedQuestions[qIndex] = { ...updatedQuestions[qIndex], _raw_svg: newSvg };
          return { ...draft, questions: updatedQuestions };
        }
        return draft;
      });
      saveDrafts(newDrafts);
      
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
      
      // Auto-save generated questions to a new draft session to prevent loss
      if (generatedQuestions && generatedQuestions.length > 0) {
        const newDraft: Draft = {
          id: Date.now().toString(),
          subjectCode: selectedSubject.code,
          subjectName: selectedSubject.name,
          date: new Date().toISOString(),
          questions: generatedQuestions
        };
        saveDrafts([newDraft, ...drafts]);
      }
      
    } catch (error) {
      console.error("Generation failed", error);
      setGenerationMessage("An error occurred during generation.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePushToSupabase = async (questionsToPush?: Question[] | React.MouseEvent | any) => {
    // If called directly from an onClick, ignore the React event object and use state
    const isEvent = questionsToPush && (questionsToPush as any).nativeEvent;
    const targetQuestions = (!questionsToPush || isEvent) ? questions : questionsToPush;
    console.log("Push attempt - subject:", selectedSubject, "questions:", targetQuestions.length);
    console.log("Supabase URL:", import.meta.env.VITE_SUPABASE_URL);
    console.log("Supabase Key exists:", !!import.meta.env.VITE_SUPABASE_ANON_KEY);
    
    if (!selectedSubject || targetQuestions.length === 0) {
      alert("No subject selected or no questions to push");
      return;
    }
    
    if (!import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
      alert("Please configure your Supabase Anon Key in the environment variables first.");
      return;
    }

    setIsSaving(true);
    setSaveProgress(0);
    setSaveMessage("Starting upload...");
    try {
      console.log("Calling pushQuestionsToSupabase...");
      const result = await pushQuestionsToSupabase(targetQuestions, (progress, message) => {
        setSaveProgress(progress);
        setSaveMessage(message);
      });
      
      if (result.successCount === 0) {
        const firstError = result.errors[0];
        let errorMsg = firstError?.message || firstError;
        if (typeof errorMsg === 'object') {
          try {
            errorMsg = JSON.stringify(errorMsg);
          } catch (e) {
            errorMsg = String(errorMsg);
          }
        }
        throw new Error(`Failed to push any questions. Error: ${errorMsg}`);
      }

      setIsPushed(true);
      
      // Remove successfully pushed questions from active view
      const successfulIds = new Set(result.successfulIndices);
      const remainingQuestions = targetQuestions.filter((_, i) => !successfulIds.has(i));
      setQuestions(remainingQuestions);
      
      // Also filter them out of any draft sessions (using question_text as proxy)
      const successfullyPushedTexts = new Set(targetQuestions.filter((_, i) => successfulIds.has(i)).map(q => q.question_text));
      const updatedDrafts = drafts.map(draft => ({
        ...draft,
        questions: draft.questions.filter(q => !successfullyPushedTexts.has(q.question_text))
      })).filter(draft => draft.questions.length > 0);
      saveDrafts(updatedDrafts);
      
      if (result.failedCount > 0) {
        setSaveMessage(`Pushed ${result.successCount} questions. ${result.failedCount} failed.`);
        alert(`Warning: ${result.failedCount} questions failed to push! They have been left in the Viewer so you can regenerate their missing diagrams and try pushing them again.`);
      } else {
        setSaveMessage("Successfully pushed all questions and diagrams to Supabase!");
        alert("Successfully pushed all questions and diagrams to Supabase!");
      }
    } catch (error: any) {
      console.error("Push failed - full error:", error);
      console.error("Error message:", error?.message);
      console.error("Error stack:", error?.stack);
      setSaveMessage("Failed to push to Supabase. Check console for details.");
      alert(`Failed to push to Supabase:\n${error?.message || error}\n\nCheck console (F12) for full details.`);
    } finally {
      setIsSaving(false);
      setSaveProgress(100);
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
    saveDrafts([newDraft, ...drafts]);
    alert("Saved to drafts! You can access it later from the dashboard.");
  };

  const loadDraft = (draft: Draft) => {
    const subject = SUBJECTS.find(s => s.code === draft.subjectCode);
    if (subject) {
      setSelectedSubject(subject);
      setQuestions(draft.questions);
      setView('viewer');
      setIsPushed(false);
    } else {
      alert("Could not find the subject for this draft.");
    }
  };

  const deleteDraft = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    saveDrafts(drafts.filter(d => d.id !== id));
  };

  const downloadJSON = () => {
    if (!selectedSubject) return;
    const safeName = selectedSubject.name.replace(/[^a-zA-Z0-9]/g, '_');
    const exportData = {
      metadata: {
        version: "1.0",
        subject_code: selectedSubject.code,
        subject_name: selectedSubject.name,
        generated_date: new Date().toISOString().split('T')[0],
        total_questions: questions.length
      },
      questions: questions.map(q => {
        const { id, ...rest } = q;
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
    a.download = `IGCSE_${safeName}_${selectedSubject.code}_Bank.json`;
    a.click();
  };

  const exportAllDrafts = () => {
    if (drafts.length === 0) return;
    
    // Group all questions from all drafts by subject_code
    const grouped = drafts.reduce((acc, draft) => {
      draft.questions.forEach(q => {
        const code = draft.subjectCode || 'unknown';
        if (!acc[code]) acc[code] = [];
        acc[code].push(q);
      });
      return acc;
    }, {} as Record<string, Question[]>);

    const today = new Date().toISOString().split('T')[0];
    
    // Create a zip-like structure with multiple files
    let allExports = '';
    Object.entries(grouped).forEach(([code, questions]: [string, Question[]]) => {
      const subjectName = SUBJECTS.find(s => s.code === code)?.name || code;
      const exportData = {
        metadata: {
          version: "1.0",
          subject_code: code,
          subject_name: subjectName,
          generated_date: today,
          total_questions: questions.length
        },
        questions: questions.map(q => {
          const { id, ...rest } = q;
          return rest;
        })
      };
      allExports += `\n\n=== ${code} - ${subjectName} ===\n`;
      allExports += JSON.stringify(exportData, null, 2);
    });

    const blob = new Blob([allExports], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `QuestionBank_Export_${today}.json`;
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

              {drafts.length > 0 && (
                <div className="mt-16">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-black tracking-tight text-gray-900">Saved Drafts</h2>
                    <span className="text-sm font-medium text-gray-500 bg-gray-100 px-3 py-1 rounded-full">{drafts.length} Drafts</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {drafts.map(draft => (
                      <motion.div
                        key={draft.id}
                        whileHover={{ scale: 1.02 }}
                        className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all cursor-pointer relative group"
                        onClick={() => loadDraft(draft)}
                      >
                        <button 
                          onClick={(e) => deleteDraft(draft.id, e)}
                          className="absolute top-4 right-4 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                          title="Delete draft"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="px-2 py-1 bg-amber-100 text-amber-800 rounded text-[10px] font-black uppercase">Draft</span>
                          <span className="text-xs font-bold text-gray-400">{draft.subjectCode}</span>
                        </div>
                        <h3 className="text-lg font-bold mb-1">{draft.subjectName}</h3>
                        <p className="text-sm text-gray-500 mb-4">{draft.questions.length} questions generated</p>
                        <div className="flex items-center text-xs text-gray-400 font-medium">
                          <Calendar className="w-3 h-3 mr-1" />
                          {new Date(draft.date).toLocaleDateString()} at {new Date(draft.date).toLocaleTimeString()}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
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
                          {[1, 2, 5, 10, 20, 40, 60, 80, 100].map(n => (
                            <option key={n} value={n}>{n} Question{n !== 1 ? 's' : ''}</option>
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
                      onClick={saveDraft}
                      className="px-6 py-3 bg-amber-500 text-white rounded-xl font-bold shadow-lg shadow-amber-200 hover:bg-amber-600 transition-all flex items-center gap-2"
                    >
                      <Save className="w-5 h-5" /> Save to Drafts
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
                    <button
                      onClick={() => { saveDrafts(questions); alert('Saved to drafts!'); }}
                      disabled={questions.length === 0}
                      className="px-6 py-3 bg-amber-500 text-white rounded-xl font-bold shadow-lg shadow-amber-200 hover:bg-amber-600 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Save className="w-5 h-5" /> Save as Draft
                    </button>
                    <button
                      onClick={() => setView('drafts')}
                      className="px-6 py-3 bg-gray-600 text-white rounded-xl font-bold shadow-lg shadow-gray-200 hover:bg-gray-700 transition-all flex items-center gap-2"
                    >
                      <Eye className="w-5 h-5" /> View Drafts ({drafts.length})
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
                    onClick={saveDraft}
                    className="px-4 py-2 bg-amber-500 text-white rounded-lg font-bold text-sm shadow-md hover:bg-amber-600 transition-all flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" /> Save Draft
                  </button>
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

                        {(q._raw_svg || (q.diagram_type && q.diagram_type !== 'None' && q.diagram_type !== 'null') || q.question_text.toLowerCase().includes('diagram') || q.question_text.toLowerCase().includes('figure')) && (
                          <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col items-center">
                            {q._raw_svg ? (
                              <div 
                                className="w-full min-h-[300px] flex items-center justify-center overflow-hidden [&>svg]:max-w-full [&>svg]:max-h-[500px] [&>svg]:h-auto"
                                dangerouslySetInnerHTML={{ __html: q._raw_svg }}
                              />
                            ) : (
                              <div className="w-full h-32 flex items-center justify-center border-2 border-dashed border-gray-300 rounded-xl text-gray-400 text-sm font-bold">
                                Missing Required Diagram
                              </div>
                            )}
                            <button
                              onClick={() => handleRegenerateDiagram(idx, q)}
                              disabled={regeneratingIndex === idx}
                              className="mt-4 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-bold shadow-sm hover:bg-gray-50 flex items-center gap-2 transition-all"
                            >
                              {regeneratingIndex === idx ? <Loader2 className="w-4 h-4 animate-spin text-blue-600" /> : <RefreshCw className="w-4 h-4 text-blue-600" />}
                              {regeneratingIndex === idx ? "Regenerating..." : (q._raw_svg ? "Regenerate Image" : "Generate Missing Image")}
                            </button>
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
                  onClick={() => {
                    if (isGenerating || questions.length > 0) {
                      setView(isGenerating ? 'generator' : 'viewer');
                    } else {
                      setView('dashboard');
                    }
                  }}
                  className="flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" /> {isGenerating || questions.length > 0 ? "Back to Generation" : "Back to Dashboard"}
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

          {view === 'drafts' && (
            <motion.div
              key="drafts"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <button 
                  onClick={() => {
                    if (isGenerating || questions.length > 0) {
                      setView(isGenerating ? 'generator' : 'viewer');
                    } else {
                      setView('dashboard');
                    }
                  }}
                  className="flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" /> {isGenerating || questions.length > 0 ? "Back to Generation" : "Back to Dashboard"}
                </button>
                <div className="flex gap-3">
                  <label className="px-4 py-2 bg-green-100 text-green-700 rounded-lg font-bold text-sm hover:bg-green-200 transition-all flex items-center gap-2 cursor-pointer">
                    <Download className="w-4 h-4" /> Import
                    <input type="file" accept=".json" onChange={importQuestions} className="hidden" />
                  </label>
                  <button 
                    onClick={clearDrafts}
                    disabled={drafts.length === 0}
                    className="px-4 py-2 bg-red-100 text-red-700 rounded-lg font-bold text-sm hover:bg-red-200 transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" /> Clear All
                  </button>
                </div>
              </div>

              <h2 className="text-2xl font-black tracking-tight flex items-center gap-2">
                <Save className="w-6 h-6 text-amber-500" />
                Saved Drafts ({drafts.length})
              </h2>

              {drafts.length === 0 ? (
                <div className="bg-white rounded-3xl border border-gray-200 overflow-hidden shadow-lg p-12 text-center">
                  <Save className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500 font-medium">No drafts saved. Generate questions and click "Save as Draft" to save them locally.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {drafts.map((q, idx) => (
                    <div key={idx} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                      <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                        <div className="flex items-center gap-3">
                          <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-[10px] font-black uppercase tracking-tighter">
                            Q{idx + 1}
                          </span>
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                            {q.topic} › {q.subtopic}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => setEditingQuestion({index: idx, question: q})}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => {
                              const newDrafts = drafts.filter((_, i) => i !== idx);
                              saveDrafts(newDrafts);
                            }}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="p-4">
                        <p className="text-sm font-medium text-gray-800">{q.question_text}</p>
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-4 pt-4">
                    <button
                      onClick={() => {
                        setQuestions(drafts);
                        setView('viewer');
                      }}
                      className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-700 transition-all flex items-center gap-2"
                    >
                      <Eye className="w-5 h-5" /> Preview All
                    </button>
                    <button
                      onClick={() => handlePushToSupabase(drafts)}
                      disabled={isSaving}
                      className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition-all flex items-center gap-2"
                    >
                      <Database className="w-5 h-5" /> Push All to Supabase
                    </button>
                    <button
                      onClick={exportAllDrafts}
                      className="px-6 py-3 bg-amber-600 text-white rounded-xl font-bold shadow-lg hover:bg-amber-700 transition-all flex items-center gap-2"
                    >
                      <Download className="w-5 h-5" /> Export All to File
                    </button>
                  </div>
                </div>
              )}
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

      {/* Edit Question Modal */}
      {editingQuestion && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-xl font-black flex items-center gap-2">
                <Pencil className="w-5 h-5 text-blue-600" /> Edit Question
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Question Text</label>
                <textarea
                  value={editingQuestion.question.question_text}
                  onChange={(e) => setEditingQuestion({...editingQuestion, question: {...editingQuestion.question, question_text: e.target.value}})}
                  className="w-full border border-gray-200 rounded-lg p-3 text-sm font-medium"
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Topic</label>
                  <input
                    type="text"
                    value={editingQuestion.question.topic}
                    onChange={(e) => setEditingQuestion({...editingQuestion, question: {...editingQuestion.question, topic: e.target.value}})}
                    className="w-full border border-gray-200 rounded-lg p-3 text-sm font-medium"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Subtopic</label>
                  <input
                    type="text"
                    value={editingQuestion.question.subtopic}
                    onChange={(e) => setEditingQuestion({...editingQuestion, question: {...editingQuestion.question, subtopic: e.target.value}})}
                    className="w-full border border-gray-200 rounded-lg p-3 text-sm font-medium"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Correct Answer</label>
                  <input
                    type="text"
                    value={editingQuestion.question.correct_answer}
                    onChange={(e) => setEditingQuestion({...editingQuestion, question: {...editingQuestion.question, correct_answer: e.target.value}})}
                    className="w-full border border-gray-200 rounded-lg p-3 text-sm font-medium"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Marks</label>
                  <input
                    type="number"
                    value={editingQuestion.question.marks}
                    onChange={(e) => setEditingQuestion({...editingQuestion, question: {...editingQuestion.question, marks: Number(e.target.value)}})}
                    className="w-full border border-gray-200 rounded-lg p-3 text-sm font-medium"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Model Answer</label>
                <textarea
                  value={editingQuestion.question.model_answer}
                  onChange={(e) => setEditingQuestion({...editingQuestion, question: {...editingQuestion.question, model_answer: e.target.value}})}
                  className="w-full border border-gray-200 rounded-lg p-3 text-sm font-medium"
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Explanation</label>
                <textarea
                  value={editingQuestion.question.explanation_json.why_correct}
                  onChange={(e) => setEditingQuestion({...editingQuestion, question: {...editingQuestion.question, explanation_json: {...editingQuestion.question.explanation_json, why_correct: e.target.value}}})}
                  className="w-full border border-gray-200 rounded-lg p-3 text-sm font-medium"
                  rows={2}
                />
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setEditingQuestion(null)}
                className="px-4 py-2 text-gray-600 font-bold hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const newDrafts = [...drafts];
                  newDrafts[editingQuestion.index] = editingQuestion.question;
                  saveDrafts(newDrafts);
                  setEditingQuestion(null);
                }}
                className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
