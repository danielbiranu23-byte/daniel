import { ArrowRight, BookOpen, CheckCircle2, ClipboardCheck, FileText, Mail, MapPin, MessageSquare, NotebookPen, Phone } from 'lucide-react';
import { useState } from 'react';
import type {
  BibleReferenceTarget,
  ChatThread,
  PublicAdminSettings,
  StudentProgress,
  StudyDocument,
} from '../types';
import { Bible3DShowcase } from './Bible3DShowcase';
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
  onOpenNotes: () => void;
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
  onOpenNotes,
  onOpenAdmin,
  onOpenBibleRef,
}: DashboardViewProps) {
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
      {/* 3D Editorial Hero Split */}
      <section className="sanctuary-card rounded-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-7 p-7 sm:p-9 lg:p-11 flex flex-col justify-between gap-7">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] font-semibold text-[#9a6b16] text-3d-gold">
              <span>Giddugala Barnoota Macaafa Qulqulluu</span>
              <span aria-hidden="true">·</span>
              <span>{settings.tutorName}</span>
            </div>

            <p className="text-sm font-semibold text-emerald-800">
              Baga nagaan dhuftan! Akkam jirtu?
            </p>

            <h1 className="font-editorial text-3xl sm:text-4xl font-bold text-[#171614] text-3d-display tracking-tight leading-[1.15] text-balance">
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
              className="btn-3d-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl whitespace-nowrap shrink-0 cursor-pointer"
            >
              <MessageSquare className="w-4 h-4 text-[#f5d08a]" aria-hidden="true" />
              <span>Chatbot Fuula Guutuutti Bani</span>
            </button>

            <button
              type="button"
              onClick={onOpenBible}
              className="btn-3d-secondary inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-[#142d4c] rounded-xl whitespace-nowrap shrink-0 cursor-pointer"
            >
              <BookOpen className="w-4 h-4" aria-hidden="true" />
              <span>Macaafa Qulqulluu Dubbisi</span>
            </button>

            {nextLesson && (
              <button
                type="button"
                onClick={() => onReadLesson(nextLesson)}
                className="btn-3d-secondary inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-[#171614] rounded-xl whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Boqonnaa Itti Aanu Dubbisi</span>
                <ArrowRight className="w-4 h-4 text-[#9a6b16]" aria-hidden="true" />
              </button>
            )}

            <button
              type="button"
              onClick={onOpenNotes}
              className="btn-3d-secondary inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-[#142d4c] rounded-xl whitespace-nowrap shrink-0 cursor-pointer"
            >
              <NotebookPen className="w-4 h-4 text-[#9a6b16]" aria-hidden="true" />
              <span>{isAdmin ? 'Yaadannoo Admin' : 'Yaadannoo Koo'}</span>
            </button>
          </div>
        </div>

        {/* Right 5 cols: Interactive 3D Open Bible + Brand Logo & Contact Directly Under 3D */}
        <div className="lg:col-span-5 relative min-h-[290px] lg:min-h-[340px] bg-gradient-to-br from-[#17365d] via-[#122b49] to-[#0b192b] border-t lg:border-t-0 lg:border-l border-[#d9d2c4] flex flex-col">
          <div className="flex-1 min-h-[240px] relative">
            <Bible3DShowcase variant="hero" />
          </div>
          <div className="px-5 py-3.5 border-t border-white/15 bg-[#0b192b]/90 text-white space-y-2">
            <div className="flex items-center gap-3">
              <img
                src="/assets/aistudio/image_27ab89bd.png"
                alt="Qajeelcha Macaafaa Qulqulluu — Daniel Biranu Logo"
                className="w-11 h-11 rounded-xl object-cover object-top border-2 border-[#d4a24c] shadow-md shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="brand-3d-viewport flex-1 min-w-0">
                    <div className="brand-3d-marquee font-editorial text-xs font-bold text-3d-brand-sculpture-light">
                      <span>Qajeelcha Macaafaa Qulqulluu · Daniel Biranu</span>
                      <span aria-hidden="true" className="text-[#d4a24c]">✦</span>
                      <span aria-hidden="true">Qajeelcha Macaafaa Qulqulluu · Daniel Biranu</span>
                      <span aria-hidden="true" className="text-[#d4a24c]">✦</span>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-zinc-300 shrink-0">Yoh 3:16</span>
                </div>
                <p className="inline-flex items-center gap-1 text-[11px] text-zinc-300">
                  <MapPin className="w-3 h-3 text-[#f5d08a] shrink-0" aria-hidden="true" />
                  <span>Bale, Oromia</span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-2 border-t border-white/10 text-[11px] text-zinc-200">
              <a
                href="mailto:danielbiranu.23@gmail.com"
                className="inline-flex items-center gap-1.5 hover:text-[#f5d08a] transition-colors"
              >
                <Mail className="w-3 h-3 text-[#f5d08a] shrink-0" aria-hidden="true" />
                <span>danielbiranu.23@gmail.com</span>
              </a>
              <a
                href="tel:+251932387559"
                className="inline-flex items-center gap-1.5 hover:text-[#f5d08a] transition-colors"
              >
                <Phone className="w-3 h-3 text-[#f5d08a] shrink-0" aria-hidden="true" />
                <span>+251932387559</span>
              </a>
            </div>
            <p className="text-[10.5px] text-zinc-300/90 pt-1 border-t border-white/10">
              © 2026 Daniel Biranu. Mirgi hundi eegamaadha!
            </p>
          </div>
        </div>
      </section>

      {/* 3D Progress Strip — Architectural Tabular Figures */}
      <section
        aria-label="Adeemsa barnootaa"
        className="sanctuary-card rounded-2xl overflow-hidden"
      >
        <div className="h-[4px] w-full bg-[#eae4d8]">
          <div
            className="h-full bg-gradient-to-r from-[#142d4c] to-[#9a6b16] transition-all duration-300"
            style={{ width: `${completionPct}%` }}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#dfd9cd]">
          <div className="px-6 py-5 flex items-baseline justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#76736c]">
                Barnoota Qophaa’e
              </p>
              <p className="text-sm text-[#52504b] mt-1">Boqonnaawwan qophaa’oo</p>
            </div>
            <span className="font-mono tabular-nums text-2xl sm:text-[30px] font-bold text-[#171614] text-3d-display">
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
            <span className="font-mono tabular-nums text-2xl sm:text-[30px] font-bold text-[#142d4c] text-3d-display">
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
            <span className="font-mono tabular-nums text-2xl sm:text-[30px] font-bold text-[#9a6b16] text-3d-gold">
              {quizzesTaken}/{documents.length}
            </span>
          </div>
        </div>
      </section>

      {/* 2-Column Workspace: Guided Study Path (Left 7) + Always-Open Live Chatbot (Right 5) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <section className="lg:col-span-7 space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#dfd9cd] pb-4">
            <div>
              <h2 className="font-editorial text-2xl font-bold text-[#171614] text-3d-subtle tracking-tight">
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
                className="btn-3d-secondary px-3 py-1.5 rounded-lg text-xs font-semibold text-[#142d4c] whitespace-nowrap shrink-0 cursor-pointer"
              >
                Admin: Faayila dabali →
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-semibold text-[#52504b]">Kakuu Filadhu:</span>
            <div className="tray-3d inline-flex items-center gap-1 p-1 rounded-xl">
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
                      ? 'tab-3d-active text-[#142d4c] font-semibold'
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
            <div className="space-y-4">
              {filteredDocuments.map((doc) => {
                const isDone = progress.completedDocIds.includes(doc.id);
                const quizInfo = progress.quizScores[doc.id];

                return (
                  <div
                    key={doc.id}
                    className="sanctuary-card-3d rounded-2xl p-5 sm:p-6 space-y-4"
                  >
                    <div className="flex items-start gap-4">
                      <span className="font-editorial text-2xl font-bold tabular-nums text-[#142d4c]/40 text-3d-subtle leading-none pt-0.5 select-none shrink-0">
                        {String(doc.order).padStart(2, '0')}
                      </span>

                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#76736c]">
                          <span className="font-semibold text-[#9a6b16]">{doc.category}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{formatBytes(doc.sizeBytes)}</span>
                          {isDone && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                                Xummurameera
                              </span>
                            </>
                          )}
                          {quizInfo && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums text-[#9a6b16] font-semibold">
                                Qormaata: {quizInfo.score}/{quizInfo.total}
                              </span>
                            </>
                          )}
                        </div>

                        <h3 className="text-base sm:text-lg font-semibold text-[#171614] text-3d-subtle leading-snug">
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
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                          isDone
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 border-b-3 hover:bg-emerald-100'
                            : 'btn-3d-secondary text-[#52504b]'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{isDone ? 'Xummurame' : 'Xummuri'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onReadLesson(doc)}
                        className="btn-3d-secondary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#171614] rounded-xl whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <BookOpen className="w-3.5 h-3.5 text-[#142d4c]" aria-hidden="true" />
                        <span>Dubbisi</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onTakeQuiz(doc)}
                        className="btn-3d-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#171614] rounded-xl whitespace-nowrap shrink-0 cursor-pointer"
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
                        className="btn-3d-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-xl whitespace-nowrap shrink-0 cursor-pointer"
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
