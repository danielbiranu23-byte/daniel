import { onAuthStateChanged } from 'firebase/auth';
import { CheckCircle2, Loader2, Mail, MapPin, Phone, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminSettingsView } from './components/AdminSettingsView';
import { AuthView } from './components/AuthView';
import { BibleReaderView } from './components/BibleReaderView';
import { ChatWorkspace } from './components/ChatWorkspace';
import { DashboardView } from './components/DashboardView';
import { FloatingChatbotWidget } from './components/FloatingChatbotWidget';
import { LessonReaderModal } from './components/LessonReaderModal';
import { LibraryView } from './components/LibraryView';
import { NotesView } from './components/NotesView';
import { OfflineIndicator } from './components/PWAInstallButton';
import { QuizModal } from './components/QuizModal';
import { Sanctuary3DBackground } from './components/Sanctuary3DBackground';
import { TopBar, type AppTab } from './components/TopBar';
import { authHeaders, extractErrorMessage, getAuthToken, safeJson, setAuthToken } from './lib/api';
import {
  auth,
  deleteChatThreadFromFirestore,
  fetchChatThreadsFromFirestore,
  fetchProgressFromFirestore,
  fetchSettingsFromFirestore,
  fetchStudyDocsFromFirestore,
  saveProgressToFirestore,
  saveSettingsToFirestore,
  saveStudyDocToFirestore,
  signOutFirebase,
  verifyConnectionWithAuth,
} from './lib/firebase';
import {
  cacheAuthUser,
  cacheBibleBundle,
  cacheChats,
  cacheCurriculum,
  getCachedAuthUser,
  getCachedBibleBundle,
  getCachedChats,
  getCachedCurriculum,
} from './lib/offlineStore';
import type {
  AuthUser,
  BibleReferenceTarget,
  ChatThread,
  PublicAdminSettings,
  StudentProgress,
  StudyDocument,
} from './types';

export default function App() {
  const [authChecking, setAuthChecking] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [loadingData, setLoadingData] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [welcomeBanner, setWelcomeBanner] = useState('');
  const [bibleTargetRef, setBibleTargetRef] = useState<BibleReferenceTarget | null>(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        void verifyConnectionWithAuth();
      }
    });
    return () => unsub();
  }, []);

  const [settings, setSettings] = useState<PublicAdminSettings>({
    tutorName: 'Barsiisaa Macaafaa AI',
    welcomeGreeting:
      'Akkam jirtu! Ani gargaaraa kee Barnoota Macaafa Qulqulluu ti. Faayiloota Adminiin qopheesse irratti hundaa’uun boqonnaa jalqabaa hanga xummuraatti sin qajeelcha.',
    systemInstructions: '',
    instructionFileName: '',
    languageMode: 'om',
    groundingMode: 'strict_files',
  });
  const [documents, setDocuments] = useState<StudyDocument[]>([]);
  const [progress, setProgress] = useState<StudentProgress>({
    completedDocIds: [],
    quizScores: {},
  });
  const [chats, setChats] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [focusDocId, setFocusDocId] = useState<string | 'all'>('all');

  const [readerDoc, setReaderDoc] = useState<StudyDocument | null>(null);
  const [quizDoc, setQuizDoc] = useState<StudyDocument | null>(null);

  const syncBibleBundleInBackground = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try {
      const existing = await getCachedBibleBundle();
      if (existing && existing.books.length >= 66) return;
      const res = await fetch('/api/offline/bible-bundle', { headers: authHeaders() });
      if (res.ok) {
        const bundle = await safeJson<{ books?: unknown[] }>(res);
        if (bundle && Array.isArray(bundle.books) && bundle.books.length > 0) {
          await cacheBibleBundle(bundle as any);
        }
      }
    } catch {
      // background sync is best-effort
    }
  }, []);

  const loadCurriculum = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error('offline');
      }
      const res = await fetch('/api/curriculum', { headers: authHeaders() });
      if (!res.ok) throw new Error('Odeeffannoo barnootaa fiduun hin danda’amne.');
      const data = await safeJson<{
        settings: PublicAdminSettings;
        documents?: StudyDocument[];
        progress?: StudentProgress;
      }>(res);
      let nextSettings = data.settings;
      let nextDocs = data.documents || [];
      let nextProgress = data.progress || { completedDocIds: [], quizScores: {} };

      const fbUser = auth.currentUser;
      if (fbUser && fbUser.emailVerified) {
        const isAdmin = userRef.current?.role === 'admin';
        try {
          const fsSettings = await fetchSettingsFromFirestore();
          if (fsSettings) {
            nextSettings = fsSettings;
          } else if (isAdmin) {
            await saveSettingsToFirestore(fbUser.uid, nextSettings);
          }

          const fsDocs = await fetchStudyDocsFromFirestore(isAdmin);
          if (fsDocs.length > 0) {
            const mergedMap = new Map<string, StudyDocument>();
            for (const d of nextDocs) mergedMap.set(d.id, d);
            for (const d of fsDocs) {
              if (d.active || isAdmin) {
                const existing = mergedMap.get(d.id);
                if (existing) {
                  mergedMap.set(d.id, {
                    ...existing,
                    ...d,
                    storedFilePath: existing.storedFilePath || d.storedFilePath,
                    textContent:
                      existing.textContent && existing.textContent.length >= d.textContent.length
                        ? existing.textContent
                        : d.textContent,
                  });
                } else {
                  mergedMap.set(d.id, d);
                }
              }
            }
            nextDocs = Array.from(mergedMap.values())
              .filter((d) => d.active)
              .sort((a, b) => a.order - b.order);
          } else if (isAdmin && nextDocs.length > 0) {
            for (const d of nextDocs) {
              await saveStudyDocToFirestore(fbUser.uid, d);
            }
          }

          const fsProgress = await fetchProgressFromFirestore(fbUser.uid);
          const mergedCompleted = Array.from(
            new Set([...nextProgress.completedDocIds, ...fsProgress.completedDocIds])
          );
          const mergedScores = { ...nextProgress.quizScores, ...fsProgress.quizScores };
          nextProgress = {
            completedDocIds: mergedCompleted,
            quizScores: mergedScores,
          };
        } catch {
          // Fallback cleanly to Express data if Firestore sync temporarily fails
        }
      }

      setSettings(nextSettings);
      setDocuments(nextDocs);
      setProgress(nextProgress);
      await cacheCurriculum({
        settings: nextSettings,
        documents: nextDocs,
        progress: nextProgress,
      });
    } catch {
      const fbUser = auth.currentUser;
      if (fbUser && fbUser.emailVerified && (typeof navigator === 'undefined' || navigator.onLine)) {
        try {
          const isAdmin = userRef.current?.role === 'admin';
          const [fsSettings, fsDocs, fsProgress] = await Promise.all([
            fetchSettingsFromFirestore(),
            fetchStudyDocsFromFirestore(isAdmin),
            fetchProgressFromFirestore(fbUser.uid),
          ]);
          const fallbackSettings: PublicAdminSettings = fsSettings || {
            tutorName: 'Barsiisaa Macaafaa AI',
            welcomeGreeting:
              'Akkam jirtu! Ani gargaaraa kee Barnoota Macaafa Qulqulluu ti.',
            systemInstructions: '',
            instructionFileName: '',
            languageMode: 'om',
            groundingMode: 'strict_files',
          };
          const activeDocs = fsDocs
            .filter((d) => d.active)
            .sort((a, b) => a.order - b.order);
          setSettings(fallbackSettings);
          setDocuments(activeDocs);
          setProgress(fsProgress);
          await cacheCurriculum({
            settings: fallbackSettings,
            documents: activeDocs,
            progress: fsProgress,
          });
          return;
        } catch {
          // fall through to IndexedDB cache
        }
      }
      const cached = await getCachedCurriculum();
      if (cached) {
        setSettings(cached.settings);
        setDocuments(cached.documents || []);
        setProgress(cached.progress || { completedDocIds: [], quizScores: {} });
        return;
      }
      throw new Error('Odeeffannoo barnootaa fiduun hin danda’amne.');
    }
  }, []);

  const loadChats = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error('offline');
      }
      const res = await fetch('/api/chats', { headers: authHeaders() });
      if (!res.ok) throw new Error('offline');
      const data = await safeJson<{ chats?: ChatThread[] }>(res);
      let nextChats = data.chats || [];

      const fbUser = auth.currentUser;
      if (fbUser && fbUser.emailVerified) {
        try {
          const fsChats = await fetchChatThreadsFromFirestore(fbUser.uid);
          if (fsChats.length > 0) {
            const byId = new Map<string, ChatThread>();
            for (const c of nextChats) byId.set(c.id, c);
            for (const fc of fsChats) {
              const existing = byId.get(fc.id);
              if (
                !existing ||
                fc.messages.length > existing.messages.length ||
                new Date(fc.updatedAt).getTime() > new Date(existing.updatedAt).getTime()
              ) {
                byId.set(fc.id, fc);
              }
            }
            nextChats = Array.from(byId.values()).sort(
              (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            );
          }
        } catch {
          // Keep Express chats if Firestore sync fails
        }
      }

      setChats(nextChats);
      await cacheChats(nextChats);
    } catch {
      const fbUser = auth.currentUser;
      if (fbUser && fbUser.emailVerified && (typeof navigator === 'undefined' || navigator.onLine)) {
        try {
          const fsChats = await fetchChatThreadsFromFirestore(fbUser.uid);
          setChats(fsChats);
          await cacheChats(fsChats);
          return;
        } catch {
          // fall through to IndexedDB cache
        }
      }
      const cachedChats = await getCachedChats();
      setChats(cachedChats);
    }
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    setLoadingData(true);
    setLoadError('');
    try {
      await Promise.all([loadCurriculum(), loadChats()]);
      void syncBibleBundleInBackground();
    } catch (err) {
      setLoadError(
        extractErrorMessage(err, 'Server waliin walqunnamuun hin danda’amne.')
      );
    } finally {
      setLoadingData(false);
    }
  }, [loadCurriculum, loadChats, syncBibleBundleInBackground]);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }

    const restoreCachedSession = async () => {
      const cachedUser = await getCachedAuthUser();
      if (cachedUser) {
        setUser(cachedUser);
        await loadWorkspaceData();
      } else {
        setUser(null);
      }
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      restoreCachedSession().finally(() => setAuthChecking(false));
      return;
    }

    fetch('/api/auth/me', { headers: authHeaders() })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          setAuthToken('');
          await cacheAuthUser(null);
          return null;
        }
        if (!res.ok) {
          return await getCachedAuthUser();
        }
        const data = await safeJson<{ user: AuthUser }>(res);
        const verified = data.user;
        await cacheAuthUser(verified);
        return verified;
      })
      .then((verifiedUser) => {
        userRef.current = verifiedUser;
        setUser(verifiedUser);
        if (verifiedUser) {
          return loadWorkspaceData();
        }
      })
      .catch(async () => {
        await restoreCachedSession();
      })
      .finally(() => setAuthChecking(false));
  }, [loadWorkspaceData]);

  const handleAuthenticated = async (authedUser: AuthUser, enteredTab: 'user' | 'admin') => {
    userRef.current = authedUser;
    setUser(authedUser);
    await cacheAuthUser(authedUser);
    setActiveTab(authedUser.role === 'admin' && enteredTab === 'admin' ? 'admin' : 'dashboard');
    setActiveThreadId(null);
    setWelcomeBanner(`Baga nagaan dhuftan, ${authedUser.fullName}! Akkam jirtu?`);
    await loadWorkspaceData();
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: authHeaders(),
    }).catch(() => {});
    await signOutFirebase();
    setAuthToken('');
    await cacheAuthUser(null);
    userRef.current = null;
    setUser(null);
    setWelcomeBanner('');
    setChats([]);
    setActiveThreadId(null);
    setActiveTab('dashboard');
  };

  const handleCreateNewChat = async (docFocus: string | 'all' = 'all') => {
    setFocusDocId(docFocus);
    setActiveThreadId(null);
    setActiveTab('chat');
  };

  const handleStartChatWithFocus = (docFocus: string | 'all' = 'all') => {
    setFocusDocId(docFocus);
    setActiveThreadId(null);
    setActiveTab('chat');
  };

  const handleOpenBibleRef = (target: BibleReferenceTarget) => {
    setBibleTargetRef({ ...target, nonce: Date.now() });
    setActiveTab('bible');
  };

  const handleDeleteThread = async (threadId: string) => {
    const nextChats = chats.filter((c) => c.id !== threadId);
    setChats(nextChats);
    await cacheChats(nextChats);
    if (activeThreadId === threadId) {
      setActiveThreadId(null);
    }
    try {
      if (auth.currentUser?.emailVerified) {
        await deleteChatThreadFromFirestore(auth.currentUser.uid, threadId).catch(() => {});
      }
      await fetch(`/api/chats/${threadId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      await loadChats();
    } catch {
      // Offline deletion already reflected locally
    }
  };

  const handleToggleComplete = async (docId: string, completed: boolean) => {
    const optimisticIds = completed
      ? Array.from(new Set([...progress.completedDocIds, docId]))
      : progress.completedDocIds.filter((id) => id !== docId);
    const optimisticProgress: StudentProgress = { ...progress, completedDocIds: optimisticIds };
    setProgress(optimisticProgress);
    await cacheCurriculum({ settings, documents, progress: optimisticProgress });

    try {
      if (auth.currentUser?.emailVerified) {
        await saveProgressToFirestore(auth.currentUser.uid, docId, { completed }).catch(() => {});
      }
      const res = await fetch('/api/study/progress', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ docId, completed }),
      });
      if (res.ok) {
        const data = await safeJson<{ progress: StudentProgress }>(res);
        setProgress(data.progress);
        await cacheCurriculum({ settings, documents, progress: data.progress });
      }
    } catch {
      // Optimistic progress saved offline
    }
  };

  const handleQuizCompleted = async (docId: string, score: number, total: number) => {
    const optimisticProgress: StudentProgress = {
      ...progress,
      quizScores: {
        ...progress.quizScores,
        [docId]: { score, total, completedAt: new Date().toISOString() },
      },
    };
    setProgress(optimisticProgress);
    await cacheCurriculum({ settings, documents, progress: optimisticProgress });

    try {
      if (auth.currentUser?.emailVerified) {
        await saveProgressToFirestore(auth.currentUser.uid, docId, {
          quizScore: score,
          quizTotal: total,
        }).catch(() => {});
      }
      const res = await fetch('/api/study/progress', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ docId, quizScore: score, quizTotal: total }),
      });
      if (res.ok) {
        const data = await safeJson<{ progress: StudentProgress }>(res);
        setProgress(data.progress);
        await cacheCurriculum({ settings, documents, progress: data.progress });
      }
    } catch {
      // Optimistic quiz score saved offline
    }
  };

  if (authChecking || loadingData) {
    return (
      <div className="relative min-h-screen bg-[#f7f6f2] flex items-center justify-center overflow-hidden">
        <Sanctuary3DBackground />
        <div className="relative z-10 sanctuary-card rounded-2xl px-6 py-4 flex items-center gap-3 text-[#52504b] text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-[#142d4c]" />
          <span className="font-medium">Barnoota Macaafa Qulqulluu qopheessaa jira...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="relative min-h-screen bg-[#f7f6f2] overflow-x-hidden">
        <Sanctuary3DBackground />
        <div className="relative z-10">
          <AuthView onAuthenticated={handleAuthenticated} />
        </div>
      </div>
    );
  }

  const effectiveTab: AppTab =
    activeTab === 'admin' && user.role !== 'admin' ? 'dashboard' : activeTab;

  return (
    <div className="relative min-h-screen flex flex-col bg-[#f7f6f2] text-[#171614]">
      <Sanctuary3DBackground />
      <div className="relative z-10 min-h-screen flex flex-col">
        <TopBar
          user={user}
          activeTab={effectiveTab}
          onSelectTab={setActiveTab}
          onNewChat={() => handleCreateNewChat('all')}
          onLogout={handleLogout}
        />

        {welcomeBanner && (
          <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-5 animate-enter">
            <div className="sanctuary-card px-4 py-3 rounded-xl bg-emerald-50 border-emerald-200 text-sm text-emerald-950 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                <span className="font-medium">{welcomeBanner}</span>
              </div>
              <button
                type="button"
                onClick={() => setWelcomeBanner('')}
                aria-label="Close welcome message"
                className="p-1 text-emerald-700 hover:text-emerald-950 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {loadError && (
          <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-6">
            <div className="sanctuary-card p-4 rounded-xl bg-red-50 border-red-200 text-sm text-red-800">
              {loadError}
            </div>
          </div>
        )}

        <main className="flex-1">
        {effectiveTab === 'dashboard' && (
          <DashboardView
            isAdmin={user.role === 'admin'}
            settings={settings}
            documents={documents}
            progress={progress}
            chats={chats}
            activeThreadId={activeThreadId}
            focusDocId={focusDocId}
            onSelectThread={setActiveThreadId}
            onChangeFocusDoc={setFocusDocId}
            onThreadsUpdated={loadChats}
            onStartChat={handleStartChatWithFocus}
            onReadLesson={setReaderDoc}
            onTakeQuiz={setQuizDoc}
            onToggleComplete={handleToggleComplete}
            onOpenBible={() => setActiveTab('bible')}
            onOpenNotes={() => setActiveTab('notes')}
            onOpenAdmin={() => setActiveTab('admin')}
            onOpenBibleRef={handleOpenBibleRef}
          />
        )}

        {effectiveTab === 'bible' && (
          <BibleReaderView
            userId={user.id}
            targetRef={bibleTargetRef}
            onOpenChatbot={() => handleStartChatWithFocus('all')}
          />
        )}

        {effectiveTab === 'chat' && (
          <ChatWorkspace
            settings={settings}
            documents={documents}
            chats={chats}
            activeThreadId={activeThreadId}
            focusDocId={focusDocId}
            onSelectThread={setActiveThreadId}
            onChangeFocusDoc={(docId) => {
              setFocusDocId(docId);
              if (activeThreadId) {
                setActiveThreadId(null);
              }
            }}
            onCreateNewChat={handleCreateNewChat}
            onDeleteThread={handleDeleteThread}
            onThreadsUpdated={loadChats}
            onReadLesson={setReaderDoc}
            onOpenBibleRef={handleOpenBibleRef}
          />
        )}

        {effectiveTab === 'library' && (
          <LibraryView
            documents={documents}
            progress={progress}
            onReadLesson={setReaderDoc}
            onStartChat={handleStartChatWithFocus}
            onTakeQuiz={setQuizDoc}
          />
        )}

        {effectiveTab === 'notes' && <NotesView user={user} />}

        {effectiveTab === 'admin' && user.role === 'admin' && (
          <AdminSettingsView
            currentUser={user}
            onUserUpdated={setUser}
            onCurriculumChanged={loadCurriculum}
            onPreviewDoc={setReaderDoc}
            onOpenNotes={() => setActiveTab('notes')}
            onEnterStudentSection={() => setActiveTab('dashboard')}
          />
        )}
      </main>

      {effectiveTab !== 'chat' && (
        <footer className="border-t-2 border-[#dfd9cd] bg-gradient-to-b from-[#ffffff] to-[#f7f4ec] py-8 mt-12 shadow-[0_-4px_20px_-8px_rgba(20,45,76,0.08)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              {/* Brand Logo + Title + Qunnamtii */}
              <div className="flex items-start sm:items-center gap-3.5">
                <span className="w-12 h-12 rounded-xl overflow-hidden bg-[#142d4c] border-2 border-[#d4a24c] border-b-3 shadow-md shrink-0">
                  <img
                    src="/assets/aistudio/image_27ab89bd.png"
                    alt="Qajeelcha Macaafaa Qulqulluu Logo"
                    className="w-full h-full object-cover object-top"
                  />
                </span>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-editorial text-base sm:text-lg font-extrabold text-3d-brand-sculpture text-3d-brand-float">
                      Qajeelcha Macaafaa Qulqulluu
                    </span>
                    <span className="font-sans text-xs font-normal text-[#76736c]">
                      · Giddugala Barnoota Macaafa Qulqulluu
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#52504b]">
                    <span className="font-semibold text-[#9a6b16]">Qunnamtii:</span>
                    <a
                      href="mailto:danielbiranu.23@gmail.com"
                      className="inline-flex items-center gap-1.5 hover:text-[#142d4c] transition-colors"
                    >
                      <Mail className="w-3.5 h-3.5 text-[#142d4c]" aria-hidden="true" />
                      <span>danielbiranu.23@gmail.com</span>
                    </a>
                    <a
                      href="tel:+251932387559"
                      className="inline-flex items-center gap-1.5 hover:text-[#142d4c] transition-colors"
                    >
                      <Phone className="w-3.5 h-3.5 text-[#142d4c]" aria-hidden="true" />
                      <span>+251932387559</span>
                    </a>
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-[#9a6b16]" aria-hidden="true" />
                      <span>Bale, Oromia</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Footer Navigation Buttons */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setActiveTab('dashboard')}
                  className="btn-3d-secondary px-3 py-1.5 rounded-lg text-xs font-medium text-[#52504b] hover:text-[#142d4c] cursor-pointer"
                >
                  Kutaa Barataa
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('bible')}
                  className="btn-3d-secondary px-3 py-1.5 rounded-lg text-xs font-medium text-[#52504b] hover:text-[#142d4c] cursor-pointer"
                >
                  Macaafa Qulqulluu
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('chat')}
                  className="btn-3d-secondary px-3 py-1.5 rounded-lg text-xs font-medium text-[#52504b] hover:text-[#142d4c] cursor-pointer"
                >
                  Chatbot
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('library')}
                  className="btn-3d-secondary px-3 py-1.5 rounded-lg text-xs font-medium text-[#52504b] hover:text-[#142d4c] cursor-pointer"
                >
                  Barnootawwan
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('notes')}
                  className="btn-3d-secondary px-3 py-1.5 rounded-lg text-xs font-medium text-[#52504b] hover:text-[#142d4c] cursor-pointer"
                >
                  {user.role === 'admin' ? 'Yaadannoo Admin' : 'Yaadannoo'}
                </button>
                {user.role === 'admin' && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('admin')}
                    className="btn-3d-secondary px-3 py-1.5 rounded-lg text-xs font-medium text-[#52504b] hover:text-[#142d4c] cursor-pointer"
                  >
                    Admin Settings
                  </button>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-[#e4e0d8] flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#76736c]">
              <p className="font-medium text-[#52504b]">
                © 2026 Daniel Biranu. Mirgi hundi eegamaadha!
              </p>
              <p className="text-[11px] text-[#76736c]">
                Bale, Oromia · Qajeelcha Macaafaa Qulqulluu 3D
              </p>
            </div>
          </div>
        </footer>
      )}

      <LessonReaderModal
        doc={readerDoc}
        isCompleted={readerDoc ? progress.completedDocIds.includes(readerDoc.id) : false}
        onClose={() => setReaderDoc(null)}
        onToggleComplete={handleToggleComplete}
        onAskChatbot={(doc) => {
          setReaderDoc(null);
          handleStartChatWithFocus(doc.id);
        }}
      />

      <QuizModal
        doc={quizDoc}
        onClose={() => setQuizDoc(null)}
        onQuizCompleted={handleQuizCompleted}
      />

      {effectiveTab !== 'chat' && (
        <FloatingChatbotWidget
          settings={settings}
          documents={documents}
          chats={chats}
          activeThreadId={activeThreadId}
          focusDocId={focusDocId}
          onSelectThread={setActiveThreadId}
          onChangeFocusDoc={setFocusDocId}
          onThreadsUpdated={loadChats}
          onExpandFullChat={() => setActiveTab('chat')}
          onOpenBibleRef={handleOpenBibleRef}
        />
      )}

      <OfflineIndicator />
      </div>
    </div>
  );
}
