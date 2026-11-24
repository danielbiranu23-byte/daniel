import {
  AlertCircle,
  BookMarked,
  CheckCircle2,
  Loader2,
  NotebookPen,
  Pin,
  PinOff,
  Plus,
  Save,
  Search,
  Shield,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { authHeaders, extractErrorMessage, safeJson } from '../lib/api';
import {
  auth,
  deleteNoteFromFirestore,
  fetchNotesFromFirestore,
  saveNoteToFirestore,
} from '../lib/firebase';
import type { AuthUser, PersonalNote } from '../types';

interface NotesViewProps {
  user: AuthUser;
}

const ADMIN_CATEGORIES = [
  'Qophii Barsiisaa',
  'Lallaba & Sagalee',
  'Karoora Barnootaa',
  'Kadhannaa',
];

const STUDENT_CATEGORIES = [
  'Qo’annoo Macaafaa',
  'Boqonnaa Barnootaa',
  'Kadhannaa',
  'Galata & Gorsa',
];

function formatNoteDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export function NotesView({ user }: NotesViewProps) {
  const isAdmin = user.role === 'admin';
  const categories = isAdmin ? ADMIN_CATEGORIES : STUDENT_CATEGORIES;

  const [notes, setNotes] = useState<PersonalNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(categories[0]);
  const [scriptureRef, setScriptureRef] = useState('');
  const [content, setContent] = useState('');
  const [pinned, setPinned] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notes', {
        cache: 'no-store',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await safeJson<{ error?: string }>(res).catch(() => ({ error: undefined }));
        throw new Error(extractErrorMessage(err.error, 'Yaadannoo fiduun hin danda’amne.'));
      }
      const data = await safeJson<{ notes?: PersonalNote[] }>(res);
      let nextNotes = (data.notes || []).filter(
        (n) => n.userId === user.id && n.ownerRole === user.role
      );

      if (auth.currentUser?.emailVerified) {
        try {
          const fsNotes = await fetchNotesFromFirestore(auth.currentUser.uid);
          if (fsNotes.length > 0) {
            const byId = new Map<string, PersonalNote>();
            for (const n of nextNotes) byId.set(n.id, n);
            for (const n of fsNotes) {
              if (n.ownerRole === user.role) {
                const existing = byId.get(n.id);
                if (!existing || n.updatedAt > existing.updatedAt) {
                  byId.set(n.id, { ...n, userId: user.id });
                }
              }
            }
            nextNotes = Array.from(byId.values()).sort((a, b) => {
              if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
              return b.updatedAt.localeCompare(a.updatedAt);
            });
          }
        } catch {
          // Use server notes cleanly if Firestore fails
        }
      }

      setNotes(nextNotes);
      if (nextNotes.length > 0) {
        setActiveNoteId((prev) => {
          if (prev && nextNotes.some((n) => n.id === prev)) return prev;
          const first = nextNotes[0];
          setTitle(first.title);
          setCategory(first.category || categories[0]);
          setScriptureRef(first.scriptureRef || '');
          setContent(first.content);
          setPinned(Boolean(first.pinned));
          return first.id;
        });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Yaadannoo fiduun hin danda’amne.'),
      });
    } finally {
      setLoading(false);
    }
  }, [categories, user.id, user.role]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const startNewNote = () => {
    setActiveNoteId(null);
    setTitle('');
    setCategory(categories[0]);
    setScriptureRef('');
    setContent('');
    setPinned(false);
    setConfirmDeleteId(null);
    setFeedback(null);
  };

  const selectNote = (note: PersonalNote) => {
    setActiveNoteId(note.id);
    setTitle(note.title);
    setCategory(note.category || categories[0]);
    setScriptureRef(note.scriptureRef || '');
    setContent(note.content);
    setPinned(Boolean(note.pinned));
    setConfirmDeleteId(null);
    setFeedback(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      setFeedback({
        type: 'error',
        text: 'Maaloo mata-duree fi qabiyyee yaadannoo guuti.',
      });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const isEditing = Boolean(activeNoteId);
      const endpoint = isEditing ? `/api/notes/${encodeURIComponent(activeNoteId!)}` : '/api/notes';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(endpoint, {
        method,
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          category: category.trim() || categories[0],
          scriptureRef: scriptureRef.trim(),
          pinned,
        }),
      });

      const data = await safeJson<{ error?: string; note?: PersonalNote }>(res);
      if (!res.ok || !data.note) {
        throw new Error(extractErrorMessage(data.error, 'Yaadannoo ol-kaa’uun hin milkoofne.'));
      }

      const saved = data.note;
      if (auth.currentUser?.emailVerified) {
        await saveNoteToFirestore(auth.currentUser.uid, saved).catch(() => {});
      }

      setNotes((prev) => {
        const filtered = prev.filter((n) => n.id !== saved.id);
        return [saved, ...filtered].sort((a, b) => {
          if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
          return b.updatedAt.localeCompare(a.updatedAt);
        });
      });
      setActiveNoteId(saved.id);
      setFeedback({
        type: 'success',
        text: isEditing
          ? 'Yaadannoon kee milkaa’inaan haaromfameera.'
          : 'Yaadannoon haaraan database irratti ol-kaa’ameera.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Dogoggorri uumameera.'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePin = async (note: PersonalNote) => {
    const nextPinned = !note.pinned;
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(note.id)}`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ pinned: nextPinned }),
      });
      const data = await safeJson<{ error?: string; note?: PersonalNote }>(res);
      if (!res.ok || !data.note) {
        throw new Error(extractErrorMessage(data.error, 'Jijjiiruun hin danda’amne.'));
      }
      const updated = data.note;
      if (auth.currentUser?.emailVerified) {
        await saveNoteToFirestore(auth.currentUser.uid, updated).catch(() => {});
      }
      setNotes((prev) =>
        prev
          .map((n) => (n.id === updated.id ? updated : n))
          .sort((a, b) => {
            if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
            return b.updatedAt.localeCompare(a.updatedAt);
          })
      );
      if (activeNoteId === updated.id) {
        setPinned(Boolean(updated.pinned));
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Dogoggorri uumameera.'),
      });
    }
  };

  const handleDeleteNote = async (note: PersonalNote) => {
    setDeletingId(note.id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(note.id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await safeJson<{ error?: string; deleted?: boolean }>(res);
      if (!res.ok) {
        throw new Error(extractErrorMessage(data.error, 'Yaadannoo haquun hin milkoofne.'));
      }
      if (auth.currentUser?.emailVerified) {
        await deleteNoteFromFirestore(auth.currentUser.uid, note.id).catch(() => {});
      }

      const remaining = notes.filter((n) => n.id !== note.id);
      setNotes(remaining);
      setConfirmDeleteId(null);

      if (activeNoteId === note.id) {
        if (remaining.length > 0) {
          selectNote(remaining[0]);
        } else {
          startNewNote();
        }
      }
      setFeedback({
        type: 'success',
        text: `Yaadannoon "${note.title}" haqameera.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Yaadannoo haquun hin danda’amne.'),
      });
    } finally {
      setDeletingId(null);
    }
  };

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return notes.filter((n) => {
      if (categoryFilter === 'pinned' && !n.pinned) return false;
      if (categoryFilter !== 'all' && categoryFilter !== 'pinned' && n.category !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        (n.scriptureRef || '').toLowerCase().includes(q) ||
        n.category.toLowerCase().includes(q)
      );
    });
  }, [categoryFilter, notes, searchQuery]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8 animate-enter">
      {/* Editorial Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#dfd9cd] pb-6">
        <div className="space-y-1.5 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] font-semibold text-[#9a6b16] text-3d-gold">
            <span>{isAdmin ? 'Kutaa Yaadannoo Admin' : 'Kutaa Yaadannoo Barataa'}</span>
            <span aria-hidden="true">·</span>
            <span>Dhuunfaa ({user.fullName})</span>
          </div>
          <h1 className="font-editorial text-2xl sm:text-3xl font-bold text-[#171614] text-3d-display tracking-tight text-balance">
            {isAdmin
              ? 'Yaadannoo Qophaa’aa Admin (Admin Notes)'
              : 'Yaadannoo Koo (Student Study Notes)'}
          </h1>
          <p className="text-sm text-[#52504b] leading-relaxed">
            {isAdmin
              ? 'Bakki kun yaadannoo Admin qofaaf qophaa’eedha — qophii barsiisaa, lallabaa fi karoorri kee barattootarraa adda ta’ee database keessatti eegama.'
              : 'Bakki kun yaadannoo kee qofaaf qophaa’eedha — yaadannoon qo’annoo Macaafa Qulqulluu fi kadhannaa kee namoota biroo irraa adda ta’ee database irratti ol-kaa’ama.'}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-medium text-[#76736c]">Baay’ina Yaadannoo</p>
            <p className="font-mono tabular-nums text-lg font-bold text-[#142d4c]">
              {notes.length}
            </p>
          </div>
          <button
            type="button"
            onClick={startNewNote}
            className="btn-3d-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[#f5d08a]" aria-hidden="true" />
            <span>Yaadannoo Haaraa</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Two-column Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left: Saved Notes List + Search & Filters */}
        <section className="lg:col-span-5 sanctuary-card rounded-2xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {isAdmin ? (
                <Shield className="w-4 h-4 text-[#9a6b16]" aria-hidden="true" />
              ) : (
                <BookMarked className="w-4 h-4 text-[#142d4c]" aria-hidden="true" />
              )}
              <h2 className="font-editorial text-lg font-bold text-[#171614] text-3d-subtle">
                {isAdmin ? 'Galmee Yaadannoo Admin' : 'Galmee Yaadannoo Kee'}
              </h2>
            </div>
            <span className="text-xs font-mono tabular-nums text-[#76736c]">
              {filteredNotes.length}/{notes.length}
            </span>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search
              className="w-4 h-4 text-[#76736c] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Yaadannoo ykn luqqisii barbaadi..."
              className="input-3d w-full pl-9 pr-3.5 py-2 text-sm rounded-xl focus:outline-none"
            />
          </div>

          {/* Interactive Category Filter Bar */}
          <div className="tray-3d flex flex-wrap items-center gap-1 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                categoryFilter === 'all'
                  ? 'tab-3d-active text-[#142d4c] font-semibold'
                  : 'text-[#52504b] hover:text-[#171614]'
              }`}
            >
              Hunda
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('pinned')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                categoryFilter === 'pinned'
                  ? 'tab-3d-active text-[#142d4c] font-semibold'
                  : 'text-[#52504b] hover:text-[#171614]'
              }`}
            >
              Filatamoo
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  categoryFilter === cat
                    ? 'tab-3d-active text-[#142d4c] font-semibold'
                    : 'text-[#52504b] hover:text-[#171614]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Notes List */}
          <div className="flex-1 space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
            {loading ? (
              <div className="py-12 flex items-center justify-center gap-2 text-sm text-[#52504b]">
                <Loader2 className="w-4 h-4 animate-spin text-[#142d4c]" aria-hidden="true" />
                <span>Yaadannoo fe’aa jira...</span>
              </div>
            ) : filteredNotes.length === 0 ? (
              <div className="sanctuary-subsurface rounded-xl p-6 text-center space-y-2">
                <NotebookPen className="w-6 h-6 text-[#9a6b16] mx-auto" aria-hidden="true" />
                <p className="text-sm font-medium text-[#171614]">
                  {notes.length === 0
                    ? 'Hanga ammaatti yaadannoon hin barreeffamne.'
                    : 'Yaadannoon barbaacha keetiin walsimu hin argamne.'}
                </p>
                <p className="text-xs text-[#52504b]">
                  Mirga irra jiruun yaadannoo haaraa barreessii “Ol-kaa’i” tuqi.
                </p>
              </div>
            ) : (
              filteredNotes.map((note) => {
                const isSelected = activeNoteId === note.id;
                const isConfirming = confirmDeleteId === note.id;
                const isDeleting = deletingId === note.id;

                return (
                  <div
                    key={note.id}
                    className={`rounded-xl p-3.5 border transition-all ${
                      isSelected
                        ? 'bg-[#f4efe4] border-[#142d4c]/40 shadow-sm'
                        : 'bg-white border-[#e4e0d8] hover:border-[#c9c0af]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => selectNote(note)}
                        className="flex-1 text-left min-w-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#142d4c] rounded"
                      >
                        <p className="font-semibold text-sm text-[#171614] truncate">
                          {note.title}
                        </p>
                        <p className="text-[11px] text-[#76736c] mt-0.5 truncate">
                          <span>{note.category}</span>
                          {note.scriptureRef && (
                            <>
                              <span aria-hidden="true"> · </span>
                              <span className="font-mono text-[#9a6b16]">{note.scriptureRef}</span>
                            </>
                          )}
                          <span aria-hidden="true"> · </span>
                          <span className="tabular-nums">{formatNoteDate(note.updatedAt)}</span>
                        </p>
                        <p className="text-xs text-[#52504b] mt-1.5 line-clamp-2 leading-relaxed">
                          {note.content}
                        </p>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleTogglePin(note)}
                          title={note.pinned ? 'Pin irraa kaasi' : 'Pin godhi'}
                          aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
                          className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                            note.pinned
                              ? 'text-[#9a6b16] bg-[#9a6b16]/10'
                              : 'text-[#76736c] hover:text-[#142d4c] hover:bg-[#f2efe9]'
                          }`}
                        >
                          {note.pinned ? (
                            <Pin className="w-3.5 h-3.5" aria-hidden="true" />
                          ) : (
                            <PinOff className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                        </button>

                        {!isConfirming && (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(note.id)}
                            title="Yaadannoo haqi"
                            aria-label={`Yaadannoo ${note.title} haqi`}
                            className="p-1.5 rounded-lg text-[#76736c] hover:text-red-700 hover:bg-red-50 cursor-pointer transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>

                    {isConfirming && (
                      <div className="mt-2.5 pt-2.5 border-t border-[#e4e0d8] flex items-center justify-between gap-2 text-xs">
                        <span className="text-red-800 font-medium">Haquu mirkaneessitaa?</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDeleteNote(note)}
                            disabled={isDeleting}
                            className="px-2.5 py-1 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 cursor-pointer disabled:opacity-50 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                          >
                            {isDeleting && <Loader2 className="w-3 h-3 animate-spin" />}
                            <span>Mirkaneessi</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            disabled={isDeleting}
                            className="btn-3d-secondary px-2.5 py-1 rounded-lg text-[#52504b] font-medium cursor-pointer whitespace-nowrap shrink-0"
                          >
                            Dhiisi
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Right: Note Editor */}
        <section className="lg:col-span-7 sanctuary-card rounded-2xl p-6 sm:p-8 flex flex-col">
          <form onSubmit={handleSave} className="flex-1 flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3 border-b border-[#e4e0d8] pb-4">
              <div>
                <p className="text-xs font-medium text-[#76736c]">
                  {activeNoteId ? 'Yaadannoo Gulaalaa Jirta' : 'Yaadannoo Haaraa Barreessaa Jirta'}
                </p>
                <h2 className="font-editorial text-xl font-bold text-[#171614] text-3d-subtle">
                  {activeNoteId ? title || 'Yaadannoo' : 'Yaadannoo Haaraa'}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setPinned((p) => !p)}
                className={`btn-3d-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl whitespace-nowrap shrink-0 cursor-pointer ${
                  pinned ? 'text-[#9a6b16] border-[#d4a24c]' : 'text-[#52504b]'
                }`}
              >
                <Pin className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{pinned ? 'Pinned (Filatamaa)' : 'Pin Godhi'}</span>
              </button>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="note-title" className="block text-xs font-medium text-[#52504b]">
                Mata-duree Yaadannoo (Title)
              </label>
              <input
                id="note-title"
                type="text"
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  isAdmin
                    ? 'Fkn: Qophii Barsiisaa — Wangeela Yohaannis Boqonnaa 3'
                    : 'Fkn: Hubannoo koo Yohaannis 3:16 irraa'
                }
                className="input-3d w-full px-3.5 py-2.5 text-sm rounded-xl focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="note-category" className="block text-xs font-medium text-[#52504b]">
                  Gosa Yaadannoo (Category)
                </label>
                <select
                  id="note-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="input-3d w-full px-3.5 py-2.5 text-sm rounded-xl focus:outline-none"
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="note-scripture" className="block text-xs font-medium text-[#52504b]">
                  Luqqisii / Boqonnaa (Dirqama miti)
                </label>
                <input
                  id="note-scripture"
                  type="text"
                  maxLength={120}
                  value={scriptureRef}
                  onChange={(e) => setScriptureRef(e.target.value)}
                  placeholder="Fkn: Yoh 3:16 ykn Rom 8:28"
                  className="input-3d w-full px-3.5 py-2.5 text-sm rounded-xl focus:outline-none font-mono"
                />
              </div>
            </div>

            <div className="flex-1 flex flex-col space-y-1.5">
              <label htmlFor="note-content" className="block text-xs font-medium text-[#52504b]">
                Qabiyyee Yaadannoo (Notes)
              </label>
              <textarea
                id="note-content"
                required
                maxLength={20000}
                rows={11}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={
                  isAdmin
                    ? 'Qabxiilee barsiisaa, ergaa lallabaa, ykn karoora barattootaa asitti qabadhu...'
                    : 'Waan dubbiste irraa baratte, luqqisii si tuqee fi kadhannaa kee asitti qabadhu...'
                }
                className="input-3d w-full flex-1 px-4 py-3 text-sm leading-relaxed rounded-xl focus:outline-none resize-y min-h-[240px]"
              />
            </div>

            <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[#e4e0d8]">
              <span className="text-xs text-[#76736c]">
                {isAdmin
                  ? 'Eegumsa: Admin qofaatu yaadannoo kana arga.'
                  : 'Eegumsa: Yaadannoon kun akkaawuntii kee qofaaf eegama.'}
              </span>

              <div className="flex items-center gap-2.5">
                {activeNoteId && (
                  <button
                    type="button"
                    onClick={startNewNote}
                    className="btn-3d-secondary px-4 py-2 text-sm font-medium text-[#52504b] rounded-xl whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Haaraa Banuu
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-3d-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="w-4 h-4 text-[#f5d08a]" aria-hidden="true" />
                  )}
                  <span>{activeNoteId ? 'Jijjiirama Ol-kaa’i' : 'Yaadannoo Ol-kaa’i'}</span>
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
