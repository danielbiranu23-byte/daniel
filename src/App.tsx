import { onAuthStateChanged } from 'firebase/auth';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminSettingsView } from './components/AdminSettingsView';
import { AuthView } from './components/AuthView';
import { BibleReaderView } from './components/BibleReaderView';
import { ChatWorkspace } from './components/ChatWorkspace';
import { DashboardView } from './components/DashboardView';
import { FloatingChatbotWidget } from './components/FloatingChatbotWidget';
import { LessonReaderModal } from './components/LessonReaderModal';
import { LibraryView } from './components/LibraryView';
import { OfflineIndicator } from './components/PWAInstallButton';
import { QuizModal } from './components/QuizModal';
import { TopBar, type AppTab } from './components/TopBar';
import { authHeaders, getAuthToken, safeJson, setAuthToken } from './lib/api';
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
                mergedMap.set(d.id, d);
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
        err instanceof Error ? err.message : 'Server waliin walqunnamuun hin danda’amne.'
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
      <div className="min-h-screen bg-[#f7f6f2] flex items-center justify-center">
        <div className="flex items-center gap-3 text-[#52504b] text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-[#142d4c]" />
          <span>Barnoota Macaafa Qulqulluu qopheessaa jira...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthView onAuthenticated={handleAuthenticated} />;
  }

  const effectiveTab: AppTab =
    activeTab === 'admin' && user.role !== 'admin' ? 'dashboard' : activeTab;

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f6f2] text-[#171614]">
      <TopBar
        user={user}
        activeTab={effectiveTab}
        onSelectTab={setActiveTab}
        onNewChat={() => handleCreateNewChat('all')}
        onLogout={handleLogout}
      />

      {welcomeBanner && (
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-5 animate-enter">
          <div className="px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-950 flex items-center justify-between gap-3">
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
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
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

        {effectiveTab === 'admin' && user.role === 'admin' && (
          <AdminSettingsView
            currentUser={user}
            onUserUpdated={setUser}
            onCurriculumChanged={loadCurriculum}
            onPreviewDoc={setReaderDoc}
            onEnterStudentSection={() => setActiveTab('dashboard')}
          />
        )}
      </main>

      {effectiveTab !== 'chat' && (
        <footer className="border-t border-[#e4e0d8] bg-white py-7 mt-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#76736c]">
            <p className="font-editorial text-sm text-[#171614]">
              Qajeelcha Macaafaa <span className="font-sans text-xs text-[#76736c]">· Giddugala Barnoota Macaafa Qulqulluu</span>
            </p>
            <div className="flex flex-wrap items-center gap-5">
              <button
                type="button"
                onClick={() => setActiveTab('dashboard')}
                className="hover:text-[#142d4c] transition-colors cursor-pointer"
              >
                Kutaa Barataa
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('bible')}
                className="hover:text-[#142d4c] transition-colors cursor-pointer"
              >
                Macaafa Qulqulluu
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('chat')}
                className="hover:text-[#142d4c] transition-colors cursor-pointer"
              >
                Chatbot
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('library')}
                className="hover:text-[#142d4c] transition-colors cursor-pointer"
              >
                Barnootawwan
              </button>
              {user.role === 'admin' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('admin')}
                  className="hover:text-[#142d4c] transition-colors cursor-pointer"
                >
                  Admin Settings
                </button>
              )}
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
  );
}
