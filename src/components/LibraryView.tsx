import { BookOpen, CheckCircle2, ClipboardCheck, MessageSquare, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { StudentProgress, StudyDocument } from '../types';

interface LibraryViewProps {
  documents: StudyDocument[];
  progress: StudentProgress;
  onReadLesson: (doc: StudyDocument) => void;
  onStartChat: (focusDocId: string) => void;
  onTakeQuiz: (doc: StudyDocument) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LibraryView({
  documents,
  progress,
  onReadLesson,
  onStartChat,
  onTakeQuiz,
}: LibraryViewProps) {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [testamentFilter, setTestamentFilter] = useState<'all' | 'old' | 'new'>('all');

  const categories = useMemo(() => {
    const unique = Array.from(new Set(documents.map((d) => d.category)));
    return ['all', ...unique];
  }, [documents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter((d) => {
      const hay = `${d.title} ${d.category} ${d.summary}`.toLowerCase();
      const matchesTestament =
        testamentFilter === 'all' ||
        (testamentFilter === 'old' ? hay.includes('kakuu moofaa') : hay.includes('kakuu haaraa'));
      const matchesCategory = selectedCategory === 'all' || d.category === selectedCategory;
      const matchesQuery =
        !q ||
        d.title.toLowerCase().includes(q) ||
        d.summary.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q) ||
        d.fileName.toLowerCase().includes(q);
      return matchesTestament && matchesCategory && matchesQuery;
    });
  }, [documents, query, selectedCategory, testamentFilter]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-6 animate-enter">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#dfd9cd] pb-5">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-[#9a6b16] text-3d-gold">
            Kuusaa Barnootaa · Study Archive
          </p>
          <h1 className="font-editorial text-2xl sm:text-3xl font-bold text-[#171614] text-3d-display tracking-tight">
            Kuusaa Barnoota Macaafa Qulqulluu
          </h1>
          <p className="text-sm text-[#52504b]">
            Faayiloota fi barnoota Adminiin qopheesse hunda barbaadi, dubbisi, ykn chatbot gaafadhu.
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search
            className="w-4 h-4 text-[#76736c] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Barnoota barbaadi..."
            className="input-3d w-full pl-9 pr-3 py-2 text-sm rounded-xl focus:outline-none"
          />
        </div>
      </div>

      {/* Testament + Category filter tabs */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="tray-3d inline-flex items-center gap-1 p-1 rounded-xl">
          {(
            [
              { id: 'all', label: 'Hundaa' },
              { id: 'old', label: 'Kakuu Moofaa' },
              { id: 'new', label: 'Kakuu Haaraa' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTestamentFilter(t.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                testamentFilter === t.id
                  ? 'tab-3d-active text-[#142d4c] font-semibold'
                  : 'text-[#52504b] hover:text-[#171614]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="tray-3d flex flex-wrap items-center gap-1 p-1 rounded-xl w-fit">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                selectedCategory === cat
                  ? 'tab-3d-active text-[#171614] font-semibold'
                  : 'text-[#52504b] hover:text-[#171614]'
              }`}
            >
              {cat === 'all' ? 'Gosa Hundaa' : cat}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="sanctuary-card rounded-2xl p-10 text-center space-y-2">
          <p className="text-sm font-medium text-[#171614]">Barnootni barbaaddame hin argamne</p>
          <p className="text-xs text-[#76736c]">Jechoota biroo yaali ykn gosa barnootaa jijjiiri.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((doc) => {
            const isDone = progress.completedDocIds.includes(doc.id);
            return (
              <div
                key={doc.id}
                className="sanctuary-card-3d rounded-2xl p-6 flex flex-col justify-between gap-5"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2 text-xs text-[#76736c]">
                    <span className="font-mono tabular-nums font-semibold text-[#9a6b16] text-3d-gold">
                      Boqonnaa {String(doc.order).padStart(2, '0')}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{doc.category}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{formatBytes(doc.sizeBytes)}</span>
                  </div>

                  <h2 className="font-editorial text-lg font-bold text-[#171614] text-3d-subtle leading-snug">
                    {doc.title}
                  </h2>
                  <p className="text-sm text-[#52504b] line-clamp-3 leading-relaxed">{doc.summary}</p>
                </div>

                <div className="pt-4 border-t border-[#dfd9cd] flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium ${
                      isDone ? 'text-emerald-700' : 'text-[#76736c]'
                    }`}
                  >
                    {isDone && <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />}
                    {isDone ? 'Xummurameera' : 'Hin xummuramne'}
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onReadLesson(doc)}
                      title="Dubbisi"
                      className="btn-3d-secondary px-2.5 py-1.5 text-xs font-semibold text-[#171614] rounded-xl cursor-pointer"
                    >
                      <BookOpen className="w-3.5 h-3.5 inline mr-1 text-[#142d4c]" />
                      Dubbisi
                    </button>
                    <button
                      type="button"
                      onClick={() => onTakeQuiz(doc)}
                      title="Qormaata"
                      className="btn-3d-secondary px-2.5 py-1.5 text-xs font-medium text-[#171614] rounded-xl cursor-pointer"
                    >
                      <ClipboardCheck className="w-3.5 h-3.5 text-[#9a6b16]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onStartChat(doc.id)}
                      title="Chatbot gaafadhu"
                      className="btn-3d-primary px-2.5 py-1.5 text-xs font-medium rounded-xl cursor-pointer"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-[#f5d08a]" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
