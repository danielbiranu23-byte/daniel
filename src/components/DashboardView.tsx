import { ArrowRight, BookOpen, CheckCircle2, ClipboardCheck, FileText, MessageSquare } from 'lucide-react';
import { useState } from 'react';
import studyHeroImg from '../assets/images/sanctuary_study_desk_1794836323351.jpg';
import type {
  BibleReferenceTarget,
  ChatThread,
  PublicAdminSettings,
  StudentProgress,
  StudyDocument,
} from '../types';
import { InlineChatPanel } from './InlineChatPanel';

interface DashboardViewProps {
  isAdmin: boolean;
  settings: PublicAdminSettings;
  documents: StudyDocument[];
  progress: StudentProgress;
  chats: ChatThread[];
  activeThreadId: string | null;
  focusDocId: string | 'all';
  onSelectThread: (threadId: string | null) => void;
  onChangeFocusDoc: (docId: string | 'all') => void;
  onThreadsUpdated: () => Promise<void>;
  onStartChat: (focusDocId?: string) => void;
  onReadLesson: (doc: StudyDocument) => void;
  onTakeQuiz: (doc: StudyDocument) => void;
  onToggleComplete: (docId: string, completed: boolean) => void;
  onOpenBible: () => void;
  onOpenAdmin: () => void;
  onOpenBibleRef: (target: BibleReferenceTarget) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DashboardView({
  isAdmin,
  settings,
  documents,
  progress,
  chats,
  activeThreadId,
  focusDocId,
  onSelectThread,
  onChangeFocusDoc,
  onThreadsUpdated,
  onStartChat,
  onReadLesson,
  onTakeQuiz,
  onToggleComplete,
  onOpenBible,
  onOpenAdmin,
  onOpenBibleRef,
}: DashboardViewProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const [testamentFilter, setTestamentFilter] = useState<'all' | 'old' | 'new'>('all');

  const filteredDocuments = documents.filter((doc) => {
    if (testamentFilter === 'all') return true;
    const hay = `${doc.title} ${doc.category} ${doc.summary}`.toLowerCase();
    return testamentFilter === 'old' ? hay.includes('kakuu moofaa') : hay.includes('kakuu haaraa');
  });

  const completedCount = documents.filter((d) => progress.completedDocIds.includes(d.id)).length;
  const quizzesTaken = Object.keys(progress.quizScores).filter((id) =>
    documents.some((d) => d.id === id)
  ).length;
  const completionPct =
    documents.length > 0 ? Math.round((completedCount / documents.length) * 100) : 0;

  const nextLesson =
    documents.find((d) => !progress.completedDocIds.includes(d.id)) || documents[0] || null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-10 animate-enter">
      {/* Editorial Hero Split */}
      <section className="sanctuary-card rounded-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-7 p-7 sm:p-9 lg:p-11 flex flex-col justify-between gap-7">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] font-semibold text-[#9a6b16]">
              <span>Giddugala Barnoota Macaafa Qulqulluu</span>
              <span aria-hidden="true">·</span>
              <span>{settings.tutorName}</span>
            </div>

            <p className="text-sm font-medium text-emerald-800">
              Baga nagaan dhuftan! Akkam jirtu?
            </p>

            <h1 className="font-editorial text-3xl sm:text-4xl font-semibold text-[#171614] tracking-tight leading-[1.15] text-balance">
              Barnoota Macaafa Qulqulluu Jalqaba hanga Xummuraatti
            </h1>

            <p className="text-base text-[#52504b] leading-relaxed max-w-2xl">
              {settings.welcomeGreeting}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => onStartChat('all')}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#142d4c] rounded-lg hover:bg-[#0e2139] shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <MessageSquare className="w-4 h-4 text-[#f5d08a]" aria-hidden="true" />
              <span>Chatbot Fuula Guutuutti Bani</span>
            </button>

            <button
              type="button"
              onClick={onOpenBible}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-[#142d4c] bg-[#f7f6f2] border border-[#142d4c]/25 rounded-lg hover:bg-[#f2efe9] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <BookOpen className="w-4 h-4" aria-hidden="true" />
              <span>Macaafa Qulqulluu Dubbisi</span>
            </button>

            {nextLesson && (
              <button
                type="button"
                onClick={() => onReadLesson(nextLesson)}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-[#171614] bg-white border border-[#e4e0d8] rounded-lg hover:bg-[#f7f6f2] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Boqonnaa Itti Aanu Dubbisi</span>
                <ArrowRight className="w-4 h-4 text-[#9a6b16]" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 relative min-h-[250px] lg:min-h-full bg-[#f2efe9] border-t lg:border-t-0 lg:border-l border-[#e4e0d8]">
          {!imgFailed ? (
            <>
              <img
                src={studyHeroImg}
                alt="Macaafa Qulqulluu fi yaadannoo qo'annoo minjaala irra jiru"
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0b192b]/80 via-[#0b192b]/30 to-transparent px-6 py-4 text-white">
                <p className="text-[11px] uppercase tracking-[0.14em] text-[#f5d08a] font-medium">
                  Sagalee Waaqayyoo · Afaan Oromo &amp; English
                </p>
              </div>
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-gradient-to-br from-[#142d4c] to-[#0e2139] text-white text-center gap-3">
              <BookOpen className="w-10 h-10 text-[#f5d08a]" />
              <p className="font-editorial text-lg font-medium">Barnoota Macaafa Qulqulluu</p>
            </div>
          )}
        </div>
      </section>

      {/* Progress Strip — Unboxed Architectural Tabular Figures */}
      <section
        aria-label="Adeemsa barnootaa"
        className="sanctuary-card rounded-2xl overflow-hidden"
      >
        <div className="h-[3px] w-full bg-[#f2efe9]">
          <div
            className="h-full bg-[#142d4c] transition-all duration-300"
            style={{ width: `${completionPct}%` }}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#e4e0d8]">
          <div className="px-6 py-5 flex items-baseline justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#76736c]">
                Barnoota Qophaa’e
              </p>
              <p className="text-sm text-[#52504b] mt-1">Boqonnaawwan qophaa’oo</p>
            </div>
            <span className="font-mono tabular-nums text-2xl sm:text-[28px] font-semibold text-[#171614]">
              {documents.length}
            </span>
          </div>

          <div className="px-6 py-5 flex items-baseline justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#76736c]">
                Adeemsa Barnootaa
              </p>
              <p className="text-sm text-[#52504b] mt-1">Boqonnaalee xummuraman</p>
            </div>
            <span className="font-mono tabular-nums text-2xl sm:text-[28px] font-semibold text-[#142d4c]">
              {completedCount}/{documents.length}
            </span>
          </div>

          <div className="px-6 py-5 flex items-baseline justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#76736c]">
                Qormaata Hubannoo
              </p>
              <p className="text-sm text-[#52504b] mt-1">Qormaata xummurame</p>
            </div>
            <span className="font-mono tabular-nums text-2xl sm:text-[28px] font-semibold text-[#9a6b16]">
              {quizzesTaken}/{documents.length}
            </span>
          </div>
        </div>
      </section>

      {/* 2-Column Workspace: Guided Study Path (Left 7) + Always-Open Live Chatbot (Right 5) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <section className="lg:col-span-7 space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#e4e0d8] pb-4">
            <div>
              <h2 className="font-editorial text-2xl font-semibold text-[#171614] tracking-tight">
                Tartiiba Barnootaa — Boqonnaa Boqonnaan
              </h2>
              <p className="text-sm text-[#52504b] mt-1">
                Jalqaba irraa kaastee boqonnaa hundumaa dubbisi, chatbot gaafadhu, akkasumas qormaata xixiqqoo fudhadhu.
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={onOpenAdmin}
                className="text-sm font-medium text-[#142d4c] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                Admin: Faayila dabali →
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-medium text-[#52504b]">Kakuu Filadhu:</span>
            <div className="inline-flex items-center gap-1 p-1 bg-[#f2efe9] border border-[#e4e0d8] rounded-xl">
              {(
                [
                  { id: 'all', label: 'Hundaa' },
                  { id: 'old', label: 'Kakuu Moofaa' },
                  { id: 'new', label: 'Kakuu Haaraa' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTestamentFilter(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                    testamentFilter === tab.id
                      ? 'bg-white text-[#142d4c] shadow-xs'
                      : 'text-[#52504b] hover:text-[#171614]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {filteredDocuments.length === 0 ? (
            <div className="sanctuary-card rounded-2xl p-10 text-center space-y-3">
              <FileText className="w-8 h-8 text-[#76736c] mx-auto" />
              <h3 className="font-editorial text-lg font-medium text-[#171614]">
                Barnootni ammaaf hin jiru
              </h3>
              <p className="text-sm text-[#52504b] max-w-md mx-auto">
                {testamentFilter !== 'all'
                  ? 'Kutaa kanaaf barnootni galmaa’e ammaaf hin jiru; "Hundaa" filadhu ykn fuula Macaafa Qulqulluu bani.'
                  : 'Adminiin Admin Settings keessa seenee faayila barnoota Macaafa Qulqulluu (.pdf, .txt, .md) ykn barreeffama haaraa ol-kaa’uu qaba.'}
              </p>
              {isAdmin && (
                <button
                  type="button"
                  onClick={onOpenAdmin}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#142d4c] rounded-lg hover:bg-[#0e2139] cursor-pointer"
                >
                  Admin Settings Bani
                </button>
              )}
            </div>
          ) : (
            <div className="sanctuary-card rounded-2xl divide-y divide-[#e4e0d8] overflow-hidden">
              {filteredDocuments.map((doc) => {
                const isDone = progress.completedDocIds.includes(doc.id);
                const quizInfo = progress.quizScores[doc.id];

                return (
                  <div
                    key={doc.id}
                    className="p-5 sm:p-6 space-y-4 hover:bg-[#f7f6f2]/80 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <span className="font-editorial text-2xl font-semibold tabular-nums text-[#142d4c]/35 leading-none pt-0.5 select-none shrink-0">
                        {String(doc.order).padStart(2, '0')}
                      </span>

                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#76736c]">
                          <span className="font-medium text-[#9a6b16]">{doc.category}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{formatBytes(doc.sizeBytes)}</span>
                          {isDone && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                                Xummurameera
                              </span>
                            </>
                          )}
                          {quizInfo && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums text-[#9a6b16] font-medium">
                                Qormaata: {quizInfo.score}/{quizInfo.total}
                              </span>
                            </>
                          )}
                        </div>

                        <h3 className="text-base sm:text-lg font-semibold text-[#171614] leading-snug">
                          {doc.title}
                        </h3>
                        <p className="text-sm text-[#52504b] line-clamp-2 leading-relaxed">{doc.summary}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-10">
                      <button
                        type="button"
                        onClick={() => onToggleComplete(doc.id, !isDone)}
                        aria-label={isDone ? 'Mark as incomplete' : 'Mark as completed'}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          isDone
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-white text-[#52504b] border-[#e4e0d8] hover:bg-[#f7f6f2]'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{isDone ? 'Xummurame' : 'Xummuri'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onReadLesson(doc)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#171614] bg-white border border-[#e4e0d8] rounded-lg hover:bg-[#f7f6f2] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <BookOpen className="w-3.5 h-3.5 text-[#142d4c]" aria-hidden="true" />
                        <span>Dubbisi</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onTakeQuiz(doc)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#171614] bg-white border border-[#e4e0d8] rounded-lg hover:bg-[#f7f6f2] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <ClipboardCheck className="w-3.5 h-3.5 text-[#9a6b16]" aria-hidden="true" />
                        <span>Qormaata</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          onChangeFocusDoc(doc.id);
                          onSelectThread(null);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#142d4c] rounded-lg hover:bg-[#0e2139] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-[#f5d08a]" aria-hidden="true" />
                        <span>Asuma Irratti Gaafadhu</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Right 5 cols: Live Chatbot Always Visible on Dashboard */}
        <aside className="lg:col-span-5 lg:sticky lg:top-24">
          <InlineChatPanel
            settings={settings}
            documents={documents}
            chats={chats}
            activeThreadId={activeThreadId}
            focusDocId={focusDocId}
            onSelectThread={onSelectThread}
            onChangeFocusDoc={onChangeFocusDoc}
            onThreadsUpdated={onThreadsUpdated}
            onExpandFullChat={() => onStartChat(focusDocId)}
            onOpenBibleRef={onOpenBibleRef}
          />
        </aside>
      </div>
    </div>
  );
}
