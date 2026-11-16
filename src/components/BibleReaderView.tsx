import {
  Bookmark,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  MessageSquare,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import bibleBannerImg from '../assets/images/sanctuary_scripture_banner_1794836323517.jpg';
import { authHeaders, extractErrorMessage, safeJson } from '../lib/api';
import {
  auth,
  deleteHighlightFromFirestore,
  fetchHighlightsFromFirestore,
  saveHighlightToFirestore,
} from '../lib/firebase';
import { searchOfflineBibleBundle } from '../lib/offlineChat';
import {
  bundleToCatalog,
  cacheBibleBundle,
  cacheBibleHighlights,
  getCachedBibleBundle,
  getCachedBibleHighlights,
} from '../lib/offlineStore';
import type {
  BibleBookCatalogItem,
  BibleChapterResponse,
  BibleHighlight,
  BibleReferenceTarget,
  BibleSearchHit,
  BibleVersePair,
  HighlightColor,
} from '../types';

interface BibleReaderViewProps {
  userId: string;
  targetRef?: BibleReferenceTarget | null;
  onOpenChatbot: () => void;
}

type BibleViewLang = 'bilingual' | 'om' | 'en';
type TestamentFilter = 'all' | 'old' | 'new';

const HIGHLIGHT_OPTIONS: Array<{
  id: HighlightColor;
  label: string;
  swatchClass: string;
  rowClass: string;
}> = [
  {
    id: 'yellow',
    label: 'Keelloo',
    swatchClass: 'bg-amber-300 border-amber-500',
    rowClass: 'bg-amber-100/65',
  },
  {
    id: 'blue',
    label: 'Cuquliisa',
    swatchClass: 'bg-sky-300 border-sky-500',
    rowClass: 'bg-sky-100/65',
  },
  {
    id: 'green',
    label: 'Magariisa',
    swatchClass: 'bg-emerald-300 border-emerald-500',
    rowClass: 'bg-emerald-100/65',
  },
  {
    id: 'rose',
    label: 'Roosii',
    swatchClass: 'bg-rose-300 border-rose-500',
    rowClass: 'bg-rose-100/65',
  },
];

export function BibleReaderView({ userId, targetRef, onOpenChatbot }: BibleReaderViewProps) {
  const [books, setBooks] = useState<BibleBookCatalogItem[]>([]);
  const [testament, setTestament] = useState<TestamentFilter>('all');
  const [bookId, setBookId] = useState(targetRef?.bookId || 'JHN');
  const [chapter, setChapter] = useState(targetRef?.chapter || 1);
  const [viewLang, setViewLang] = useState<BibleViewLang>('bilingual');

  const [chapterData, setChapterData] = useState<BibleChapterResponse | null>(null);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [loadingChapter, setLoadingChapter] = useState(false);
  const [error, setError] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchHits, setSearchHits] = useState<BibleSearchHit[] | null>(null);
  const [highlightVerse, setHighlightVerse] = useState<number | null>(targetRef?.verse ?? null);
  const [copiedVerse, setCopiedVerse] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);

  const [highlights, setHighlights] = useState<BibleHighlight[]>([]);
  const [showSavedPanel, setShowSavedPanel] = useState(false);
  const [savedColorFilter, setSavedColorFilter] = useState<'all' | HighlightColor>('all');
  const [saveToast, setSaveToast] = useState('');
  const [bannerFailed, setBannerFailed] = useState(false);

  const ensureOfflineBundle = useCallback(async () => {
    const existing = await getCachedBibleBundle();
    if (existing && existing.books.length > 0) return existing;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
    try {
      const res = await fetch('/api/offline/bible-bundle', { headers: authHeaders() });
      if (!res.ok) return null;
      const bundle = await safeJson<{ books?: unknown[] }>(res);
      if (bundle && Array.isArray(bundle.books) && bundle.books.length > 0) {
        await cacheBibleBundle(bundle as any);
        return bundle;
      }
    } catch {
      return null;
    }
    return null;
  }, []);

  useEffect(() => {
    const loadCatalog = async () => {
      try {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          throw new Error('offline');
        }
        const res = await fetch('/api/bible/books', { headers: authHeaders() });
        if (!res.ok) throw new Error('Kitaabota Macaafa Qulqulluu fiduun hin danda’amne.');
        const data = await safeJson<{ books?: BibleBookCatalogItem[] }>(res);
        setBooks(data.books || []);
        void ensureOfflineBundle();
      } catch (err) {
        const bundle = await getCachedBibleBundle();
        if (bundle && bundle.books.length > 0) {
          setBooks(bundleToCatalog(bundle));
          setError('');
        } else {
          setError(err instanceof Error ? err.message : 'Dogoggorri uumameera.');
        }
      } finally {
        setLoadingBooks(false);
      }
    };
    void loadCatalog();
  }, [ensureOfflineBundle]);

  const loadChapter = useCallback(async (targetBookId: string, targetChapter: number) => {
    setLoadingChapter(true);
    setError('');

    const loadFromBundle = async (): Promise<boolean> => {
      const bundle = await getCachedBibleBundle();
      const found = bundle?.books.find((b) => b.id === targetBookId);
      const ch = found?.chapters.find((c) => c.n === targetChapter);
      if (found && ch) {
        setChapterData({
          bookId: found.id,
          omName: found.omName,
          enName: found.enName,
          chapter: ch.n,
          totalChapters: found.chapters.length,
          verses: ch.v.map(([num, om, en]) => ({ number: num, om, en })),
        });
        return true;
      }
      return false;
    };

    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (await loadFromBundle()) return;
        throw new Error('Boqonnaan kun offline irratti ammallee hin kuufamne.');
      }
      const res = await fetch(
        `/api/bible/chapter?bookId=${encodeURIComponent(targetBookId)}&chapter=${targetChapter}`,
        { headers: authHeaders() }
      );
      const data = await safeJson<BibleChapterResponse & { error?: string }>(res);
      if (!res.ok) throw new Error(data.error || 'Boqonnaa banuun hin danda’amne.');
      setChapterData(data);
    } catch (err) {
      if (await loadFromBundle()) {
        setError('');
      } else {
        setError(err instanceof Error ? err.message : 'Dogoggorri uumameera.');
      }
    } finally {
      setLoadingChapter(false);
    }
  }, []);

  useEffect(() => {
    if (!targetRef) return;
    setTestament('all');
    setBookId(targetRef.bookId);
    setChapter(targetRef.chapter);
    setHighlightVerse(targetRef.verse ?? null);
    setShowSavedPanel(false);
    setSearchHits(null);
  }, [targetRef]);

  useEffect(() => {
    const loadHighlights = async () => {
      try {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          throw new Error('offline');
        }
        const res = await fetch('/api/bible/highlights', { headers: authHeaders() });
        if (!res.ok) throw new Error('offline');
        const data = await safeJson<{ highlights?: BibleHighlight[] }>(res);
        let list = data.highlights || [];

        if (auth.currentUser?.emailVerified) {
          try {
            const fsList = await fetchHighlightsFromFirestore(auth.currentUser.uid);
            if (fsList.length > 0) {
              const merged = new Map<string, BibleHighlight>();
              for (const h of list) merged.set(h.id, h);
              for (const fh of fsList) {
                const prev = merged.get(fh.id);
                if (!prev || new Date(fh.savedAt).getTime() >= new Date(prev.savedAt).getTime()) {
                  merged.set(fh.id, fh);
                }
              }
              list = Array.from(merged.values()).sort(
                (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
              );
            } else if (list.length > 0) {
              for (const h of list) {
                await saveHighlightToFirestore(auth.currentUser.uid, h);
              }
            }
          } catch {
            // Keep Express highlights if Firestore sync fails
          }
        }

        setHighlights(list);
        await cacheBibleHighlights(userId, list);
      } catch {
        const cached = await getCachedBibleHighlights(userId);
        setHighlights(cached);
      }
    };
    void loadHighlights();
  }, [userId]);

  useEffect(() => {
    loadChapter(bookId, chapter);
  }, [bookId, chapter, loadChapter]);

  useEffect(() => {
    if (!loadingChapter && highlightVerse !== null && chapterData) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`bible-verse-${highlightVerse}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [loadingChapter, highlightVerse, chapterData]);

  const showQuickToast = (msg: string) => {
    setSaveToast(msg);
    setTimeout(() => setSaveToast((prev) => (prev === msg ? '' : prev)), 2200);
  };

  const handleToggleHighlight = async (v: BibleVersePair, color: HighlightColor) => {
    if (!chapterData) return;
    const id = `${chapterData.bookId.toUpperCase()}:${chapterData.chapter}:${v.number}`;
    const existing = highlights.find((h) => h.id === id);

    // Clicking the same active color removes the highlight
    if (existing && existing.color === color) {
      const next = highlights.filter((h) => h.id !== id);
      setHighlights(next);
      await cacheBibleHighlights(userId, next);
      showQuickToast(`${chapterData.omName} ${chapterData.chapter}:${v.number} haqameera.`);
      try {
        if (typeof navigator === 'undefined' || navigator.onLine) {
          if (auth.currentUser?.emailVerified) {
            await deleteHighlightFromFirestore(auth.currentUser.uid, id).catch(() => {});
          }
          const res = await fetch(`/api/bible/highlights/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: authHeaders(),
          });
          if (res.ok) {
            const data = await safeJson<{ highlights?: BibleHighlight[] }>(res);
            if (data.highlights) {
              setHighlights(data.highlights);
              await cacheBibleHighlights(userId, data.highlights);
            }
          }
        }
      } catch {
        // already persisted in IndexedDB offline
      }
      return;
    }

    const newEntry: BibleHighlight = {
      id,
      bookId: chapterData.bookId.toUpperCase(),
      omName: chapterData.omName,
      enName: chapterData.enName,
      chapter: chapterData.chapter,
      verse: v.number,
      omText: v.om,
      enText: v.en,
      color,
      savedAt: new Date().toISOString(),
    };

    const next = existing
      ? highlights.map((h) => (h.id === id ? newEntry : h))
      : [newEntry, ...highlights];
    setHighlights(next);
    await cacheBibleHighlights(userId, next);
    showQuickToast(`${chapterData.omName} ${chapterData.chapter}:${v.number} halluu godhamee ol-kaa’ameera.`);

    try {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        if (auth.currentUser?.emailVerified) {
          await saveHighlightToFirestore(auth.currentUser.uid, newEntry).catch(() => {});
        }
        const res = await fetch('/api/bible/highlights', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            bookId: newEntry.bookId,
            omName: newEntry.omName,
            enName: newEntry.enName,
            chapter: newEntry.chapter,
            verse: newEntry.verse,
            omText: newEntry.omText,
            enText: newEntry.enText,
            color: newEntry.color,
          }),
        });
        if (res.ok) {
          const data = await safeJson<{ highlights?: BibleHighlight[] }>(res);
          if (data.highlights) {
            const merged = new Map<string, BibleHighlight>();
            for (const h of data.highlights) merged.set(h.id, h);
            merged.set(newEntry.id, newEntry);
            const mergedList = Array.from(merged.values()).sort(
              (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
            );
            setHighlights(mergedList);
            await cacheBibleHighlights(userId, mergedList);
          }
        }
      }
    } catch {
      // already persisted in IndexedDB offline
    }
  };

  const handleRemoveSavedHighlight = async (id: string) => {
    const next = highlights.filter((h) => h.id !== id);
    setHighlights(next);
    await cacheBibleHighlights(userId, next);
    try {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        if (auth.currentUser?.emailVerified) {
          await deleteHighlightFromFirestore(auth.currentUser.uid, id).catch(() => {});
        }
        const res = await fetch(`/api/bible/highlights/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: authHeaders(),
        });
        if (res.ok) {
          const data = await safeJson<{ highlights?: BibleHighlight[] }>(res);
          if (data.highlights) {
            setHighlights(data.highlights);
            await cacheBibleHighlights(userId, data.highlights);
          }
        }
      }
    } catch {
      // offline removal already saved locally
    }
  };

  const handleJumpToHighlight = (h: BibleHighlight) => {
    setTestament('all');
    setBookId(h.bookId);
    setChapter(h.chapter);
    setHighlightVerse(h.verse);
    setShowSavedPanel(false);
  };

  const handleBookChange = (nextBookId: string) => {
    setBookId(nextBookId);
    setChapter(1);
    setHighlightVerse(null);
  };

  const handleTestamentChange = (nextTestament: TestamentFilter) => {
    setTestament(nextTestament);
    setHighlightVerse(null);
    if (nextTestament === 'all') return;
    const pool = books.filter((b) => b.testament === nextTestament);
    if (pool.length > 0 && !pool.some((b) => b.id === bookId)) {
      setBookId(pool[0].id);
      setChapter(1);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchHits(null);
      return;
    }
    setSearching(true);
    setError('');
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error('offline');
      }
      const res = await fetch(
        `/api/bible/search?q=${encodeURIComponent(trimmed)}&testament=${testament}`,
        { headers: authHeaders() }
      );
      const data = await safeJson<{ error?: string; hits?: BibleSearchHit[] }>(res);
      if (!res.ok) throw new Error(data.error || 'Barbaachi hin milkoofne.');
      setSearchHits(data.hits || []);
    } catch (err) {
      const bundle = await getCachedBibleBundle();
      if (bundle) {
        setSearchHits(searchOfflineBibleBundle(bundle, trimmed, testament));
        setError('');
      } else {
        setError(extractErrorMessage(err, 'Dogoggorri uumameera.'));
      }
    } finally {
      setSearching(false);
    }
  };

  const handleJumpToHit = (hit: BibleSearchHit) => {
    setBookId(hit.bookId);
    setChapter(hit.chapter);
    setHighlightVerse(hit.verse);
    setSearchHits(null);
  };

  const handleCopyVerse = async (v: BibleVersePair) => {
    if (!chapterData) return;
    const refOm = `${chapterData.omName} ${chapterData.chapter}:${v.number}`;
    const refEn = `${chapterData.enName} ${chapterData.chapter}:${v.number}`;
    const text =
      viewLang === 'bilingual'
        ? `${refOm} (${refEn})\n${v.om}\n${v.en}`
        : viewLang === 'om'
          ? `${refOm}\n${v.om}`
          : `${refEn}\n${v.en}`;
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopiedVerse(v.number);
    setTimeout(() => setCopiedVerse((prev) => (prev === v.number ? null : prev)), 1800);
  };

  const handleDownloadBook = async () => {
    setDownloading(true);
    try {
      let blob: Blob | null = null;
      if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
          const res = await fetch(
            `/api/bible/download/${encodeURIComponent(bookId)}?lang=${viewLang}`,
            { headers: authHeaders() }
          );
          if (res.ok) blob = await res.blob();
        } catch {
          blob = null;
        }
      }

      if (!blob) {
        const bundle = await getCachedBibleBundle();
        const found = bundle?.books.find((b) => b.id === bookId);
        if (!found) throw new Error('Faayila buusuun hin danda’amne.');
        const lines: string[] = [`# ${found.omName} (${found.enName})`, ''];
        for (const ch of found.chapters) {
          lines.push(`## Boqonnaa ${ch.n} / Chapter ${ch.n}`, '');
          for (const [num, om, en] of ch.v) {
            if (viewLang === 'bilingual') {
              lines.push(`**${num}.** [OM] ${om}  \n[EN] ${en}`, '');
            } else if (viewLang === 'om') {
              lines.push(`**${num}.** ${om}`, '');
            } else {
              lines.push(`**${num}.** ${en}`, '');
            }
          }
        }
        blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${bookId.toLowerCase()}_${viewLang}_bible.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(extractErrorMessage(err, 'Dogoggorri uumameera.'));
    } finally {
      setDownloading(false);
    }
  };

  const totalChapters = chapterData?.totalChapters || 1;
  const chapterOptions = Array.from({ length: totalChapters }, (_, idx) => idx + 1);

  if (loadingBooks) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 flex items-center justify-center gap-2.5 text-sm text-[#52504b]">
        <Loader2 className="w-5 h-5 animate-spin text-[#142d4c]" />
        <span>Macaafa Qulqulluu banaa jira...</span>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-6 animate-enter">
      {/* Sanctuary Editorial Header Banner */}
      <section className="sanctuary-card rounded-2xl overflow-hidden relative">
        {!bannerFailed && (
          <img
            src={bibleBannerImg}
            alt="Macaafa Qulqulluu afaan lamaan"
            referrerPolicy="no-referrer"
            onError={() => setBannerFailed(true)}
            className="hidden lg:block absolute inset-y-0 right-0 w-1/2 h-full object-cover"
          />
        )}
        <div className="relative z-10 px-6 sm:px-8 py-6 sm:py-7 bg-gradient-to-r from-white via-white lg:via-white/95 lg:to-white/60 flex flex-wrap items-end justify-between gap-5">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] font-semibold text-[#9a6b16]">
              <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Kitaaba Qulqulluu (1999) · World English Bible</span>
            </div>
            <h1 className="font-editorial text-2xl sm:text-3xl font-semibold text-[#171614] tracking-tight">
              Macaafa Qulqulluu — Afaan Oromo &amp; English
            </h1>
            <p className="text-sm text-[#52504b] leading-relaxed">
              Kitaabota 66 guutuu afaan lamaaniin dubbisi, kutaa sitti tole halluu godhii ol-kaa’i, barbaadi, yookiin Chatbot gaafadhu.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowSavedPanel((prev) => !prev)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                showSavedPanel
                  ? 'bg-[#fbf6ea] border-[#e8d8b5] text-[#7c530e]'
                  : 'bg-white/95 border-[#e4e0d8] text-[#171614] hover:bg-[#f7f6f2]'
              }`}
            >
              <Bookmark className="w-4 h-4 text-[#9a6b16]" aria-hidden="true" />
              <span>Kan Ol-Kaa’ame ({highlights.length})</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadBook}
              disabled={downloading}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-[#171614] bg-white/95 border border-[#e4e0d8] rounded-lg hover:bg-[#f7f6f2] transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {downloading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4 text-[#52504b]" />
              )}
              <span>Kitaaba Buufadhu (.md)</span>
            </button>

            <button
              type="button"
              onClick={onOpenChatbot}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#142d4c] rounded-lg hover:bg-[#0e2139] shadow-xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <MessageSquare className="w-4 h-4 text-[#f5d08a]" />
              <span>Chatbot Afaan Lamaan Gaafadhu</span>
            </button>
          </div>
        </div>
      </section>

      {saveToast && (
        <div className="px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-900 flex items-center justify-between animate-enter">
          <span>{saveToast}</span>
          <button
            type="button"
            onClick={() => setSaveToast('')}
            aria-label="Close notice"
            className="text-emerald-700 hover:text-emerald-950 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Saved & Highlighted Verses Panel */}
      {showSavedPanel && (
        <section className="sanctuary-card rounded-2xl p-5 sm:p-6 space-y-4 animate-enter">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e4e0d8] pb-3.5">
            <div>
              <h2 className="font-editorial text-lg font-semibold text-[#171614]">
                Luqqisiiwwan Halluu &amp; Ol-Kaa’aman ({highlights.length})
              </h2>
              <p className="text-xs text-[#52504b]">
                Kutaa sitti tole halluu cuqaasuun ol-kaa’i; asitti tuquun kallattiidhaan bakka barreeffamichaa seeni.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSavedColorFilter('all')}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg border cursor-pointer transition-colors ${
                  savedColorFilter === 'all'
                    ? 'bg-[#142d4c] text-white border-[#142d4c]'
                    : 'bg-white text-[#52504b] border-[#e4e0d8] hover:bg-[#f7f6f2]'
                }`}
              >
                Hundaa
              </button>
              {HIGHLIGHT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSavedColorFilter(opt.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border cursor-pointer transition-colors ${
                    savedColorFilter === opt.id
                      ? 'bg-[#142d4c] text-white border-[#142d4c]'
                      : 'bg-white text-[#52504b] border-[#e4e0d8] hover:bg-[#f7f6f2]'
                  }`}
                >
                  <span className={`w-2.5 h-2.5 rounded-full border ${opt.swatchClass}`} />
                  <span>{opt.label}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowSavedPanel(false)}
                aria-label="Close saved verses"
                className="p-1 text-[#76736c] hover:text-[#171614] cursor-pointer ml-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {highlights.filter((h) => savedColorFilter === 'all' || h.color === savedColorFilter).length === 0 ? (
            <p className="text-sm text-[#76736c] py-5 text-center">
              Luqqisiin ol-kaa’ame ammaaf hin jiru. Gadi bu’iitii lakkoofsa sitti tole cinaatti mallattoo halluu filadhu!
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-3">
              {highlights
                .filter((h) => savedColorFilter === 'all' || h.color === savedColorFilter)
                .map((h) => {
                  const styleOpt = HIGHLIGHT_OPTIONS.find((o) => o.id === h.color) || HIGHLIGHT_OPTIONS[0];
                  return (
                    <div
                      key={h.id}
                      className={`p-4 rounded-xl border border-[#e4e0d8] flex flex-col justify-between gap-2.5 ${styleOpt.rowClass}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => handleJumpToHighlight(h)}
                          className="text-left group cursor-pointer"
                        >
                          <p className="text-xs font-semibold text-[#142d4c] font-mono tabular-nums group-hover:underline">
                            {h.omName} ({h.enName}) {h.chapter}:{h.verse}
                          </p>
                          <p className="text-sm text-[#171614] mt-1 line-clamp-2">{h.omText}</p>
                          <p className="text-xs text-[#52504b] italic mt-0.5 line-clamp-2">{h.enText}</p>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRemoveSavedHighlight(h.id)}
                          title="Haqi"
                          aria-label="Remove saved verse"
                          className="p-1 text-[#76736c] hover:text-red-600 rounded cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center justify-between text-[11px]">
                        <span className="inline-flex items-center gap-1.5 text-[#52504b]">
                          <span className={`w-2.5 h-2.5 rounded-full border ${styleOpt.swatchClass}`} />
                          {styleOpt.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleJumpToHighlight(h)}
                          className="font-medium text-[#142d4c] hover:underline cursor-pointer"
                        >
                          Macaafa irratti bani →
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </section>
      )}

      {/* Controls: Testament, Book, Chapter, Language, Search */}
      <section className="sanctuary-card rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-[#e4e0d8]">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-medium text-[#52504b]">Kakuu Filadhu:</span>
            <div className="inline-flex items-center gap-1 p-1 bg-[#f2efe9] border border-[#e4e0d8] rounded-xl">
              {(
                [
                  { id: 'all', label: `Hunduma (${books.length})` },
                  {
                    id: 'old',
                    label: `Kakuu Moofaa (${books.filter((b) => b.testament === 'old').length})`,
                  },
                  {
                    id: 'new',
                    label: `Kakuu Haaraa (${books.filter((b) => b.testament === 'new').length})`,
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleTestamentChange(opt.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                    testament === opt.id
                      ? 'bg-white text-[#142d4c] shadow-xs'
                      : 'text-[#52504b] hover:text-[#171614]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <span className="text-xs font-mono tabular-nums text-[#76736c]">
            {books.find((b) => b.id === bookId)?.testament === 'old'
              ? 'Kakuu Moofaa (Old Testament)'
              : 'Kakuu Haaraa (New Testament)'}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
          {/* Book Selector */}
          <div className="lg:col-span-4 space-y-1.5">
            <label htmlFor="reader-book-select" className="block text-xs font-medium text-[#52504b]">
              Kitaaba ({testament === 'old' ? 'Kakuu Moofaa — 39' : testament === 'new' ? 'Kakuu Haaraa — 27' : '66 Kitaabota'})
            </label>
            <select
              id="reader-book-select"
              value={bookId}
              onChange={(e) => handleBookChange(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[#f7f6f2] border border-[#e4e0d8] rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#142d4c]"
            >
              {(testament === 'all' || testament === 'old') && (
                <optgroup label="Kakuu Moofaa (Old Testament — 39)">
                  {books
                    .filter((b) => b.testament === 'old')
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {String(b.order).padStart(2, '0')}. {b.omName} — {b.enName}
                      </option>
                    ))}
                </optgroup>
              )}
              {(testament === 'all' || testament === 'new') && (
                <optgroup label="Kakuu Haaraa (New Testament — 27)">
                  {books
                    .filter((b) => b.testament === 'new')
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {String(b.order).padStart(2, '0')}. {b.omName} — {b.enName}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Chapter Selector + Prev/Next */}
          <div className="lg:col-span-4 space-y-1.5">
            <label htmlFor="reader-chapter-select" className="block text-xs font-medium text-[#52504b]">
              Boqonnaa / Chapter ({chapter}/{totalChapters})
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setHighlightVerse(null);
                  setChapter((c) => Math.max(1, c - 1));
                }}
                disabled={chapter <= 1}
                aria-label="Boqonnaa duraa"
                className="p-2 text-[#52504b] bg-[#f7f6f2] border border-[#e4e0d8] rounded-lg hover:bg-[#f2efe9] disabled:opacity-40 cursor-pointer shrink-0"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <select
                id="reader-chapter-select"
                value={chapter}
                onChange={(e) => {
                  setHighlightVerse(null);
                  setChapter(Number(e.target.value));
                }}
                className="flex-1 px-3 py-2 text-sm font-mono tabular-nums bg-[#f7f6f2] border border-[#e4e0d8] rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#142d4c]"
              >
                {chapterOptions.map((n) => (
                  <option key={n} value={n}>
                    Boqonnaa {n} / Chapter {n}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => {
                  setHighlightVerse(null);
                  setChapter((c) => Math.min(totalChapters, c + 1));
                }}
                disabled={chapter >= totalChapters}
                aria-label="Boqonnaa itti aanu"
                className="p-2 text-[#52504b] bg-[#f7f6f2] border border-[#e4e0d8] rounded-lg hover:bg-[#f2efe9] disabled:opacity-40 cursor-pointer shrink-0"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Display Mode */}
          <div className="lg:col-span-4 space-y-1.5">
            <span className="block text-xs font-medium text-[#52504b]">Afaan Dubbisaa</span>
            <div className="grid grid-cols-3 gap-1 p-1 bg-[#f2efe9] border border-[#e4e0d8] rounded-xl">
              {(
                [
                  { id: 'bilingual', label: 'Afaan Lamaan' },
                  { id: 'om', label: 'Afaan Oromo' },
                  { id: 'en', label: 'English' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setViewLang(opt.id)}
                  className={`py-1.5 px-2 text-xs font-medium rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                    viewLang === opt.id
                      ? 'bg-white text-[#142d4c] shadow-xs'
                      : 'text-[#52504b] hover:text-[#171614]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Search across all 66 books */}
        <form onSubmit={handleSearch} className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 pt-3 border-t border-[#e4e0d8]">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-[#76736c] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Barbaadi: luqqisii ykn jecha (fkn: Yohn 14:6, Faarfannaa 23, jaalala, peace)..."
              className="w-full pl-9 pr-8 py-2 text-sm bg-[#f7f6f2] border border-[#e4e0d8] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#142d4c] focus:bg-white transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchHits(null);
                }}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#76736c] hover:text-[#171614] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={searching}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#142d4c] rounded-lg hover:bg-[#0e2139] transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>Barbaadi</span>
          </button>
        </form>

        {/* Search Results Drawer */}
        {searchHits !== null && (
          <div className="pt-2 space-y-2.5">
            <div className="flex items-center justify-between text-xs text-[#76736c]">
              <span className="font-mono tabular-nums">
                Bu’aa barbaachaa ({searchHits.length})
              </span>
              <button
                type="button"
                onClick={() => setSearchHits(null)}
                className="text-[#142d4c] font-medium hover:underline cursor-pointer"
              >
                Cufi
              </button>
            </div>

            {searchHits.length === 0 ? (
              <p className="text-sm text-[#52504b] py-3">
                Jecha kanaaf bu’aan hin argamne. Maqaa kitaabaa fi boqonnaa (fkn: Yohn 3:16 ykn Luq 12:8) yaali.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y divide-[#e4e0d8] border border-[#e4e0d8] rounded-xl bg-[#f7f6f2]">
                {searchHits.map((hit, idx) => (
                  <button
                    key={`${hit.bookId}-${hit.chapter}-${hit.verse}-${idx}`}
                    type="button"
                    onClick={() => handleJumpToHit(hit)}
                    className="w-full text-left p-3.5 hover:bg-white transition-colors cursor-pointer space-y-1"
                  >
                    <p className="text-xs font-semibold text-[#142d4c] font-mono tabular-nums">
                      {hit.omName} ({hit.enName}) {hit.chapter}:{hit.verse}
                    </p>
                    <p className="text-sm text-[#171614]">{hit.om}</p>
                    <p className="text-xs text-[#52504b] italic">{hit.en}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-900">
          {error}
        </div>
      )}

      {/* Chapter Reading Surface */}
      <section className="sanctuary-card rounded-2xl overflow-hidden">
        <div className="px-6 sm:px-8 py-5 border-b border-[#e4e0d8] bg-[#f7f6f2]/80 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-editorial text-xl sm:text-2xl font-semibold text-[#171614] tracking-tight">
              {chapterData
                ? `${chapterData.omName} ${chapterData.chapter} — ${chapterData.enName} ${chapterData.chapter}`
                : 'Dubbisa Macaafa Qulqulluu'}
            </h2>
            <p className="text-xs text-[#76736c] font-mono tabular-nums mt-0.5">
              Lakkoofsa {chapterData?.verses.length || 0} · Afaan Oromo (Kitaaba Qulqulluu 1999) &amp; English (WEB)
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setHighlightVerse(null);
                setChapter((c) => Math.max(1, c - 1));
              }}
              disabled={chapter <= 1}
              className="px-3.5 py-1.5 text-xs font-medium text-[#171614] bg-white border border-[#e4e0d8] rounded-lg hover:bg-[#f2efe9] disabled:opacity-40 cursor-pointer whitespace-nowrap"
            >
              ← Boqonnaa Duraa
            </button>
            <button
              type="button"
              onClick={() => {
                setHighlightVerse(null);
                setChapter((c) => Math.min(totalChapters, c + 1));
              }}
              disabled={chapter >= totalChapters}
              className="px-3.5 py-1.5 text-xs font-medium text-[#171614] bg-white border border-[#e4e0d8] rounded-lg hover:bg-[#f2efe9] disabled:opacity-40 cursor-pointer whitespace-nowrap"
            >
              Boqonnaa Itti Aanu →
            </button>
          </div>
        </div>

        {loadingChapter ? (
          <div className="py-16 flex items-center justify-center gap-2 text-sm text-[#52504b]">
            <Loader2 className="w-5 h-5 animate-spin text-[#142d4c]" />
            <span>Boqonnaa banaa jira...</span>
          </div>
        ) : (
          <div className="divide-y divide-[#efede7]">
            {viewLang === 'bilingual' && (
              <div className="hidden md:grid md:grid-cols-12 bg-[#f2efe9]/65 border-b border-[#e4e0d8] px-6 sm:px-8 py-2.5 text-[11px] uppercase tracking-[0.12em] font-semibold text-[#52504b]">
                <div className="col-span-6 pr-4">Afaan Oromo</div>
                <div className="col-span-6 pl-4">English (World English Bible)</div>
              </div>
            )}

            {(chapterData?.verses || []).map((v) => {
              const isFocused = highlightVerse === v.number;
              const verseId = `${(chapterData?.bookId || bookId).toUpperCase()}:${chapterData?.chapter || chapter}:${v.number}`;
              const savedHighlight = highlights.find((h) => h.id === verseId);
              const colorMeta = savedHighlight
                ? HIGHLIGHT_OPTIONS.find((o) => o.id === savedHighlight.color)
                : null;

              const rowBg = colorMeta
                ? colorMeta.rowClass
                : isFocused
                  ? 'bg-[#142d4c]/[0.06]'
                  : 'hover:bg-[#f7f6f2]/85';

              const verseActions = (
                <div className="flex items-center gap-1 shrink-0">
                  <div
                    className="inline-flex items-center gap-1 px-1.5 py-1 rounded-lg bg-white/90 border border-[#e4e0d8]"
                    title="Kutaa kana halluu godhiitii ol-kaa’i"
                  >
                    {HIGHLIGHT_OPTIONS.map((opt) => {
                      const active = savedHighlight?.color === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleToggleHighlight(v, opt.id)}
                          title={
                            active
                              ? `${opt.label} haqi`
                              : `${opt.label} tiin halluu godhii ol-kaa’i`
                          }
                          aria-label={`Highlight verse ${v.number} ${opt.label}`}
                          className={`w-3.5 h-3.5 rounded-full border transition-transform cursor-pointer ${opt.swatchClass} ${
                            active ? 'ring-2 ring-offset-1 ring-[#142d4c] scale-110' : 'opacity-75 hover:opacity-100'
                          }`}
                        />
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyVerse(v)}
                    title="Luqqisii waraabi (Copy)"
                    className="p-1.5 text-[#76736c] hover:text-[#142d4c] rounded-lg hover:bg-white/90 cursor-pointer shrink-0"
                  >
                    {copiedVerse === v.number ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              );

              return (
                <div
                  key={v.number}
                  id={`bible-verse-${v.number}`}
                  className={`px-5 sm:px-8 py-4.5 transition-colors ${rowBg} ${
                    isFocused ? 'ring-2 ring-inset ring-[#142d4c]/45' : ''
                  }`}
                >
                  {viewLang === 'bilingual' ? (
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-6 items-start">
                      <div className="md:col-span-6 flex items-start gap-3">
                        <span className="font-mono tabular-nums text-xs font-semibold text-[#9a6b16] pt-1 w-6 shrink-0">
                          {v.number}
                        </span>
                        <p className="text-[15.5px] leading-[1.78] text-[#171614]">{v.om}</p>
                      </div>
                      <div className="md:col-span-6 flex items-start justify-between gap-3 md:border-l md:border-[#e4e0d8] md:pl-6">
                        <div className="flex items-start gap-2.5">
                          <span className="font-mono tabular-nums text-xs font-semibold text-[#76736c] pt-1 w-6 shrink-0 md:hidden">
                            {v.number}
                          </span>
                          <p className="text-[15px] leading-[1.78] text-[#52504b]">{v.en}</p>
                        </div>
                        {verseActions}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-4">
                      <div className="max-w-2xl flex items-start gap-3.5">
                        <span className="font-mono tabular-nums text-xs font-semibold text-[#9a6b16] pt-1.5 w-6 shrink-0">
                          {v.number}
                        </span>
                        <p className="text-[16.5px] leading-[1.82] text-[#171614]">
                          {viewLang === 'om' ? v.om : v.en}
                        </p>
                      </div>
                      {verseActions}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
