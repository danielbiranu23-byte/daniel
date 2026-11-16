import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  FileUp,
  KeyRound,
  Loader2,
  Save,
  Trash2,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { authHeaders, extractErrorMessage, safeJson } from '../lib/api';
import {
  auth,
  deleteStudyDocFromFirestore,
  fetchSettingsFromFirestore,
  fetchStudyDocsFromFirestore,
  saveSettingsToFirestore,
  saveStudyDocToFirestore,
} from '../lib/firebase';
import type {
  AuthUser,
  BibleBookCatalogItem,
  GroundingMode,
  LanguageMode,
  PublicAdminSettings,
  StudyDocument,
} from '../types';

interface AdminSettingsViewProps {
  currentUser: AuthUser;
  onUserUpdated: (user: AuthUser) => void;
  onCurriculumChanged: () => Promise<void>;
  onPreviewDoc: (doc: StudyDocument) => void;
  onEnterStudentSection: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AdminSettingsView({
  currentUser,
  onUserUpdated,
  onCurriculumChanged,
  onPreviewDoc,
  onEnterStudentSection,
}: AdminSettingsViewProps) {
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<StudyDocument[]>([]);
  const [registeredUsers, setRegisteredUsers] = useState<AuthUser[]>([]);
  const [settings, setSettings] = useState<PublicAdminSettings>({
    tutorName: 'Barsiisaa Macaafaa AI',
    welcomeGreeting: '',
    systemInstructions: '',
    instructionFileName: '',
    languageMode: 'om',
    groundingMode: 'strict_files',
  });

  // Upload / Create Lesson state
  const [uploadMode, setUploadMode] = useState<'file' | 'text'>('file');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [docTitle, setDocTitle] = useState('');
  const [docCategory, setDocCategory] = useState('Bu’uura Barnootaa');
  const [docOrder, setDocOrder] = useState(1);
  const [lessonText, setLessonText] = useState('');

  // Admin Credentials state
  const [adminFullName, setAdminFullName] = useState(currentUser.fullName);
  const [adminUsername, setAdminUsername] = useState(currentUser.username);
  const [adminNewPassword, setAdminNewPassword] = useState('');

  // Free Oromo & English Bible catalog state
  const [bibleBooks, setBibleBooks] = useState<BibleBookCatalogItem[]>([]);
  const [bibleReady, setBibleReady] = useState(false);
  const [bibleTestament, setBibleTestament] = useState<'all' | 'old' | 'new'>('all');
  const [selectedBookId, setSelectedBookId] = useState('JHN');
  const [selectedBibleLang, setSelectedBibleLang] = useState<'bilingual' | 'om' | 'en'>('bilingual');
  const [bibleBusy, setBibleBusy] = useState<'import' | 'download' | 'install' | null>(null);
  const [docTestamentFilter, setDocTestamentFilter] = useState<'all' | 'old' | 'new'>('all');

  const [busyAction, setBusyAction] = useState(false);
  const [uploadingInstructionFile, setUploadingInstructionFile] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadAdminData = useCallback(async () => {
    try {
      const [docsRes, bibleRes] = await Promise.all([
        fetch('/api/admin/documents', { headers: authHeaders() }),
        fetch('/api/admin/bible/catalog', { headers: authHeaders() }),
      ]);
      if (!docsRes.ok) {
        const err = await safeJson<{ error?: string }>(docsRes).catch(() => ({ error: undefined }));
        throw new Error(extractErrorMessage(err.error, 'Odeeffannoo Admin fiduun hin danda’amne.'));
      }
      const data = await safeJson<{
        documents?: StudyDocument[];
        settings: PublicAdminSettings;
        users?: AuthUser[];
      }>(docsRes);
      setDocuments(data.documents || []);
      setSettings(data.settings);
      setRegisteredUsers(data.users || []);
      setDocOrder((data.documents?.length || 0) + 1);

      if (bibleRes.ok) {
        const bData = await safeJson<{
          books?: BibleBookCatalogItem[];
          installedOm?: boolean;
          installedEn?: boolean;
        }>(bibleRes);
        setBibleBooks(bData.books || []);
        setBibleReady(Boolean(bData.installedOm && bData.installedEn));
      }
    } catch (err) {
      if (auth.currentUser?.emailVerified && currentUser.role === 'admin') {
        const [fsDocs, fsSettings] = await Promise.all([
          fetchStudyDocsFromFirestore(true),
          fetchSettingsFromFirestore(),
        ]);
        setDocuments(fsDocs);
        if (fsSettings) setSettings(fsSettings);
        setDocOrder(fsDocs.length + 1);
        return;
      }
      throw err;
    }
  }, [currentUser.role]);

  useEffect(() => {
    loadAdminData()
      .catch((err) => {
        setFeedback({
          type: 'error',
          text: extractErrorMessage(err, 'Dogoggorri uumameera.'),
        });
      })
      .finally(() => setLoading(false));
  }, [loadAdminData]);

  const handleInstallBible = async () => {
    setBibleBusy('install');
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/bible/install', {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await safeJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || 'Macaafa Qulqulluu fe’uun hin danda’amne.');
      await loadAdminData();
      setFeedback({
        type: 'success',
        text: 'Macaafni Qulqulluun (66 Kitaabota — Afaan Oromo & English) tola milkaa’inaan fe’ameera.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Dogoggorri uumameera.'),
      });
    } finally {
      setBibleBusy(null);
    }
  };

  const handleImportBibleBook = async (overrideBookId?: string) => {
    const targetId = overrideBookId || selectedBookId;
    setBibleBusy('import');
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/bible/import-book', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          bookId: targetId,
          language: selectedBibleLang,
        }),
      });
      const data = await safeJson<{ error?: string; document: StudyDocument }>(res);
      if (!res.ok) throw new Error(data.error || 'Kitaaba dabaluun hin milkoofne.');
      if (auth.currentUser?.emailVerified && data.document) {
        await saveStudyDocToFirestore(auth.currentUser.uid, data.document).catch(() => {});
      }
      await loadAdminData();
      await onCurriculumChanged();
      setFeedback({
        type: 'success',
        text: `Faayilli "${data.document.title}" gara barnootaatti milkaa’inaan dabalameera.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Dogoggorri uumameera.'),
      });
    } finally {
      setBibleBusy(null);
    }
  };

  const handleDownloadBibleBook = async () => {
    setBibleBusy('download');
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/admin/bible/download/${selectedBookId}?lang=${selectedBibleLang}`,
        { headers: authHeaders() }
      );
      if (!res.ok) {
        const err = await safeJson<{ error?: string }>(res).catch(() => ({ error: undefined }));
        throw new Error(err.error || 'Faayila buusuun hin danda’amne.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedBookId.toLowerCase()}_${selectedBibleLang}_bible.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setFeedback({
        type: 'success',
        text: `Faayilli "${selectedBookId.toLowerCase()}_${selectedBibleLang}_bible.md" buufameera.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Dogoggorri uumameera.'),
      });
    } finally {
      setBibleBusy(null);
    }
  };

  const handleUploadFiles = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFiles.length === 0) {
      setFeedback({ type: 'error', text: 'Maaloo dura faayila (.pdf, .txt, .md) filadhu.' });
      return;
    }

    setBusyAction(true);
    setFeedback(null);
    try {
      const formData = new FormData();
      for (const file of selectedFiles) {
        formData.append('files', file);
      }
      formData.append('title', docTitle);
      formData.append('category', docCategory);
      formData.append('order', String(docOrder));

      const res = await fetch('/api/admin/documents/upload', {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });
      const data = await safeJson<{ error?: string; documents?: StudyDocument[] }>(res);
      if (!res.ok) throw new Error(data.error || 'Ol-kaa’uun hin milkoofne.');

      if (auth.currentUser?.emailVerified && data.documents) {
        for (const createdDoc of data.documents) {
          await saveStudyDocToFirestore(auth.currentUser.uid, createdDoc).catch(() => {});
        }
      }

      const count = (data.documents || []).length;
      setSelectedFiles([]);
      setDocTitle('');
      setLessonText('');
      await loadAdminData();
      await onCurriculumChanged();
      setFeedback({
        type: 'success',
        text: `Faayiloonni ${count} milkaa’inaan ol-kaa’amanii jiru. Barattoonni Dashboard fi Chatbot irratti argu.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Dogoggorri uumameera.'),
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleCreateTextLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docTitle.trim() || !lessonText.trim()) {
      setFeedback({ type: 'error', text: 'Mata-duree fi qabiyyeen barnootaa guutamuu qabu.' });
      return;
    }

    setBusyAction(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/documents/text', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          title: docTitle,
          category: docCategory,
          order: docOrder,
          content: lessonText,
        }),
      });
      const data = await safeJson<{ error?: string; document: StudyDocument }>(res);
      if (!res.ok) throw new Error(data.error || 'Barnoota uumuun hin milkoofne.');

      if (auth.currentUser?.emailVerified && data.document) {
        await saveStudyDocToFirestore(auth.currentUser.uid, data.document).catch(() => {});
      }

      setDocTitle('');
      setLessonText('');
      await loadAdminData();
      await onCurriculumChanged();
      setFeedback({
        type: 'success',
        text: `Barnootni "${data.document.title}" milkaa’inaan ol-kaa’ameera.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Dogoggorri uumameera.'),
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleUploadInstructionFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingInstructionFile(true);
    setFeedback(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/admin/settings/instructions-file', {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });
      const data = await safeJson<{ error?: string; settings: PublicAdminSettings }>(res);
      if (!res.ok) throw new Error(data.error || 'Faayila qajeelfamaa ol-kaa’uun hin milkoofne.');

      if (auth.currentUser?.emailVerified && data.settings) {
        await saveSettingsToFirestore(auth.currentUser.uid, data.settings).catch(() => {});
      }

      setSettings(data.settings);
      await onCurriculumChanged();
      setFeedback({
        type: 'success',
        text: `Faayilli qajeelfama Chatbot "${file.name}" milkaa’inaan ol-kaa’ameera.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Dogoggorri uumameera.'),
      });
    } finally {
      setUploadingInstructionFile(false);
      e.target.value = '';
    }
  };

  const handleToggleActive = async (doc: StudyDocument) => {
    try {
      const res = await fetch(`/api/admin/documents/${doc.id}`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ active: !doc.active }),
      });
      if (!res.ok) throw new Error('Haala jijjiiruun hin danda’amne.');
      if (auth.currentUser?.emailVerified) {
        await saveStudyDocToFirestore(auth.currentUser.uid, {
          ...doc,
          active: !doc.active,
        }).catch(() => {});
      }
      await loadAdminData();
      await onCurriculumChanged();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Dogoggorri uumameera.'),
      });
    }
  };

  const handleDeleteDoc = async (doc: StudyDocument) => {
    try {
      const res = await fetch(`/api/admin/documents/${doc.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Haquun hin danda’amne.');
      if (auth.currentUser?.emailVerified) {
        await deleteStudyDocFromFirestore(doc.id).catch(() => {});
      }
      await loadAdminData();
      await onCurriculumChanged();
      setFeedback({ type: 'success', text: `"${doc.title}" haqameera.` });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Dogoggorri uumameera.'),
      });
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyAction(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(settings),
      });
      const data = await safeJson<{ error?: string; settings: PublicAdminSettings }>(res);
      if (!res.ok) throw new Error(data.error || 'Settings ol-kaa’uun hin milkoofne.');

      if (auth.currentUser?.emailVerified && data.settings) {
        await saveSettingsToFirestore(auth.currentUser.uid, data.settings).catch(() => {});
      }

      setSettings(data.settings);
      await onCurriculumChanged();
      setFeedback({ type: 'success', text: 'Qindaa’inni Chatbot milkaa’inaan ol-kaa’ameera.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Dogoggorri uumameera.'),
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleSaveAdminCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyAction(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/credentials', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          fullName: adminFullName,
          username: adminUsername,
          newPassword: adminNewPassword || undefined,
        }),
      });
      const data = await safeJson<{ error?: string; user: AuthUser }>(res);
      if (!res.ok) throw new Error(data.error || 'Maqaa fi password Admin jijjiiruun hin milkoofne.');

      onUserUpdated(data.user);
      setAdminNewPassword('');
      await loadAdminData();
      setFeedback({
        type: 'success',
        text: `Maqaa Admin (${data.user.username}) fi password milkaa’inaan haaromfameera.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractErrorMessage(err, 'Dogoggorri uumameera.'),
      });
    } finally {
      setBusyAction(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 flex items-center justify-center text-sm text-zinc-600 gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-[#142d4c]" />
        <span>Admin Settings banaa jira...</span>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#e4e0d8] pb-5 animate-enter">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-[#9a6b16]">
            Bulchiinsa Giddugalaa · Admin Workbench
          </p>
          <h1 className="font-editorial text-2xl sm:text-3xl font-semibold text-[#171614] tracking-tight">
            Admin Settings — Faayilootaa fi Qindaa’ina Chatbot
          </h1>
          <p className="text-sm text-[#52504b] mt-1">
            Faayiloota Barnoota Macaafa Qulqulluu fi qajeelfama Chatbot asitti ol-kaa’i; maqaa fi password Admin keetis asitti jijjiiri.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onEnterStudentSection}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#142d4c] rounded-lg hover:bg-[#0e2139] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>Kutaa Barataa Seeni</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
          <p className="text-xs text-zinc-500 font-mono">
            Admin: {currentUser.username}
          </p>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-4 rounded-xl border text-sm flex items-start gap-2.5 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Free 66-Book Oromo & English Bible Panel */}
      <section className="sanctuary-card rounded-2xl p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <BookOpen className="w-5 h-5 text-[#142d4c]" />
              <h2 className="font-editorial text-xl font-semibold text-zinc-900">
                Faayila Macaafa Qulqulluu Bilisaa (Afaan Oromo &amp; English — 100% Free)
              </h2>
            </div>
            <p className="text-sm text-zinc-600">
              Eeyyee, faayilli kun guutummaatti tola (100% Free / Open License) dha: Kitaabota 66 Afaan Oromo (Biblica Open) fi English (World English Bible) Chatbot keessatti qophaa’eera; asitti immoo kitaaba barbaadde gara barnootaatti dabaluu ykn faayila `.md` gootee buufachuu dandeessa.
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-zinc-600 shrink-0">
            Kitaabota {bibleBooks.length} · Bilisa (Free)
          </span>
        </div>

        {!bibleReady ? (
          <div className="p-4 rounded-xl bg-[#f7f6f2] border border-[#e4e0d8] flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-700">
              Faayila Macaafa Qulqulluu guutuu (66 kitaabota) Afaan Oromo fi English tola fe’i.
            </p>
            <button
              type="button"
              onClick={handleInstallBible}
              disabled={bibleBusy !== null}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#142d4c] rounded-lg hover:bg-[#0e2139] transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {bibleBusy === 'install' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span>Macaafa Qulqulluu Fe’i (Free)</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-zinc-100">
              <span className="text-xs font-medium text-zinc-600">Kakuu Filadhu:</span>
              <div className="inline-flex items-center gap-1 p-1 bg-[#f2efe9] border border-[#e4e0d8] rounded-lg">
                {(
                  [
                    { id: 'all', label: `Hunduma (${bibleBooks.length})` },
                    {
                      id: 'old',
                      label: `Kakuu Moofaa (${bibleBooks.filter((b) => b.testament === 'old').length})`,
                    },
                    {
                      id: 'new',
                      label: `Kakuu Haaraa (${bibleBooks.filter((b) => b.testament === 'new').length})`,
                    },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setBibleTestament(opt.id);
                      if (opt.id !== 'all') {
                        const pool = bibleBooks.filter((b) => b.testament === opt.id);
                        if (pool.length > 0 && !pool.some((b) => b.id === selectedBookId)) {
                          setSelectedBookId(pool[0].id);
                        }
                      }
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                      bibleTestament === opt.id
                        ? 'bg-white text-[#142d4c] shadow-sm'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
              <div className="md:col-span-5 space-y-1.5">
                <label htmlFor="bible-book-select" className="block text-xs font-medium text-zinc-700">
                  Kitaaba Macaafa Qulqulluu ({bibleTestament === 'old' ? 'Kakuu Moofaa — 39' : bibleTestament === 'new' ? 'Kakuu Haaraa — 27' : '66 Kitaabota'})
                </label>
                <select
                  id="bible-book-select"
                  value={selectedBookId}
                  onChange={(e) => setSelectedBookId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#e4e0d8] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#142d4c]"
                >
                  {(bibleTestament === 'all' || bibleTestament === 'old') && (
                    <optgroup label="Kakuu Moofaa (Old Testament — 39)">
                      {bibleBooks
                        .filter((b) => b.testament === 'old')
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {String(b.order).padStart(2, '0')}. {b.omName} — {b.enName} ({b.chapters} boqonnaa)
                          </option>
                        ))}
                    </optgroup>
                  )}
                  {(bibleTestament === 'all' || bibleTestament === 'new') && (
                    <optgroup label="Kakuu Haaraa (New Testament — 27)">
                      {bibleBooks
                        .filter((b) => b.testament === 'new')
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {String(b.order).padStart(2, '0')}. {b.omName} — {b.enName} ({b.chapters} boqonnaa)
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div className="md:col-span-3 space-y-1.5">
                <label htmlFor="bible-lang-select" className="block text-xs font-medium text-zinc-700">
                  Afaan Faayilichaa
                </label>
                <select
                  id="bible-lang-select"
                  value={selectedBibleLang}
                  onChange={(e) =>
                    setSelectedBibleLang(e.target.value as 'bilingual' | 'om' | 'en')
                  }
                  className="w-full px-3 py-2 text-sm bg-white border border-[#e4e0d8] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#142d4c]"
                >
                  <option value="bilingual">Afaan Oromo + English</option>
                  <option value="om">Afaan Oromo Qofa</option>
                  <option value="en">English Qofa</option>
                </select>
              </div>

              <div className="md:col-span-4 flex flex-wrap sm:flex-nowrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => handleImportBibleBook()}
                  disabled={bibleBusy !== null}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#142d4c] rounded-lg hover:bg-[#0e2139] transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  {bibleBusy === 'import' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FilePlus2 className="w-4 h-4" />
                  )}
                  <span>Gara Barnootaatti Dabali</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadBibleBook}
                  disabled={bibleBusy !== null}
                  className="inline-flex items-center justify-center gap-2 px-3.5 py-2 text-sm font-medium text-zinc-800 bg-white border border-[#e4e0d8] rounded-lg hover:bg-zinc-50 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  {bibleBusy === 'download' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span>Buufadhu (.md)</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-zinc-500">Filannoo ariifataa:</span>
              {(bibleTestament === 'old'
                ? [
                    { id: 'GEN', label: 'Seera Uumamaa (Genesis)' },
                    { id: 'EXO', label: 'Seera Ba’uu (Exodus)' },
                    { id: 'PSA', label: 'Faarfannaa (Psalms)' },
                    { id: 'PRO', label: 'Fakkeenya (Proverbs)' },
                    { id: 'ISA', label: 'Isaayaas (Isaiah)' },
                  ]
                : bibleTestament === 'new'
                  ? [
                      { id: 'MAT', label: 'Maatewos (Matthew)' },
                      { id: 'MRK', label: 'Maarqoos (Mark)' },
                      { id: 'LUK', label: 'Luqaas (Luke)' },
                      { id: 'JHN', label: 'Yohaannis (John)' },
                      { id: 'ROM', label: 'Roomaa (Romans)' },
                      { id: 'EPH', label: 'Efesoon (Ephesians)' },
                    ]
                  : [
                      { id: 'GEN', label: 'Seera Uumamaa (Genesis)' },
                      { id: 'PSA', label: 'Faarfannaa (Psalms)' },
                      { id: 'MAT', label: 'Maatewos (Matthew)' },
                      { id: 'LUK', label: 'Luqaas (Luke)' },
                      { id: 'JHN', label: 'Yohaannis (John)' },
                      { id: 'ROM', label: 'Roomaa (Romans)' },
                    ]
              ).map((quick) => (
                <button
                  key={quick.id}
                  type="button"
                  onClick={() => {
                    setSelectedBookId(quick.id);
                    handleImportBibleBook(quick.id);
                  }}
                  disabled={bibleBusy !== null}
                  className="px-2.5 py-1 text-xs font-medium text-[#142d4c] bg-[#f7f6f2] border border-[#e4e0d8] rounded-md hover:border-[#142d4c]/40 hover:bg-[#142d4c]/5 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  + {quick.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Grid: Upload Study Files + Chatbot Settings & Instruction File Upload */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left 7 cols: Multi-File Upload or Create Lesson */}
        <section className="lg:col-span-7 sanctuary-card rounded-2xl p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-editorial text-xl font-semibold text-zinc-900">
              1. Faayiloota Chatbot &amp; Barnootaa Ol-Kaa’i
            </h2>

            <div className="flex items-center gap-1 p-1 bg-[#f2efe9] border border-[#e4e0d8] rounded-lg">
              <button
                type="button"
                onClick={() => setUploadMode('file')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  uploadMode === 'file'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Faayila Ol-Kaa’i (PDF / TXT / MD)
              </button>
              <button
                type="button"
                onClick={() => setUploadMode('text')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  uploadMode === 'text'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Barreeffamaan Qopheessi
              </button>
            </div>
          </div>

          <form
            onSubmit={uploadMode === 'file' ? handleUploadFiles : handleCreateTextLesson}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
              <div className="sm:col-span-6 space-y-1.5">
                <label htmlFor="doc-title" className="block text-xs font-medium text-zinc-700">
                  Mata-duree Barnootaa {uploadMode === 'file' && '(yoo faayila 1 ta’e)'}
                </label>
                <input
                  id="doc-title"
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="Fkn: Boqonnaa 4: Seenaa Daawit"
                  className="w-full px-3 py-2 text-sm bg-white border border-[#e4e0d8] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#142d4c]"
                />
              </div>

              <div className="sm:col-span-4 space-y-1.5">
                <label htmlFor="doc-category" className="block text-xs font-medium text-zinc-700">
                  Gosa Barnootaa
                </label>
                <input
                  id="doc-category"
                  type="text"
                  value={docCategory}
                  onChange={(e) => setDocCategory(e.target.value)}
                  placeholder="Kakuu Moofaa / Haaraa"
                  className="w-full px-3 py-2 text-sm bg-white border border-[#e4e0d8] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#142d4c]"
                />
              </div>

              <div className="sm:col-span-2 space-y-1.5">
                <label htmlFor="doc-order" className="block text-xs font-medium text-zinc-700">
                  Tartiiba
                </label>
                <input
                  id="doc-order"
                  type="number"
                  min={1}
                  value={docOrder}
                  onChange={(e) => setDocOrder(Number(e.target.value) || 1)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-[#e4e0d8] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#142d4c]"
                />
              </div>
            </div>

            {uploadMode === 'file' ? (
              <div className="space-y-2">
                <label
                  htmlFor="study-file-input"
                  className="flex flex-col items-center justify-center border-2 border-dashed border-[#e4e0d8] rounded-xl p-8 bg-[#f7f6f2] hover:border-[#142d4c]/60 transition-colors cursor-pointer text-center"
                >
                  <FileUp className="w-7 h-7 text-[#142d4c] mb-2" />
                  <p className="text-sm font-medium text-zinc-900">
                    {selectedFiles.length > 0
                      ? `Faayiloota ${selectedFiles.length} filatamaniiru`
                      : 'Faayila tokko ykn hedduu kompiyuutara irraa filadhu'}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">
                    {selectedFiles.length > 0
                      ? selectedFiles.map((f) => f.name).join(', ')
                      : 'PDF, Markdown (.md), Text (.txt), CSV, JSON, HTML (hanga faayila 10 al-tokkotti)'}
                  </p>
                  <input
                    id="study-file-input"
                    type="file"
                    multiple
                    accept=".pdf,.txt,.md,.csv,.json,.html"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      setSelectedFiles(files);
                      if (files.length === 1 && !docTitle.trim()) {
                        setDocTitle(files[0].name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' '));
                      }
                    }}
                    className="sr-only"
                  />
                </label>
              </div>
            ) : (
              <div className="space-y-1.5">
                <label htmlFor="lesson-content" className="block text-xs font-medium text-zinc-700">
                  Qabiyyee Barnootaa (Markdown ykn Barreeffama Idilee)
                </label>
                <textarea
                  id="lesson-content"
                  rows={8}
                  value={lessonText}
                  onChange={(e) => setLessonText(e.target.value)}
                  placeholder="# Mata-duree&#10;&#10;Barreeffama barnoota Macaafa Qulqulluu fi luqqisiiwwan asitti barreessi..."
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#e4e0d8] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#142d4c]"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={busyAction}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#142d4c] rounded-lg hover:bg-[#0e2139] transition-colors cursor-pointer disabled:opacity-50"
            >
              {busyAction ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FilePlus2 className="w-4 h-4" />
              )}
              <span>
                {uploadMode === 'file' ? 'Faayila/Faayiloota Ol-Kaa’i' : 'Barnoota Galmeessi'}
              </span>
            </button>
          </form>
        </section>

        {/* Right 5 cols: Chatbot Persona, File-based Instructions & Grounding */}
        <section className="lg:col-span-5 sanctuary-card rounded-2xl p-6 space-y-5">
          <h2 className="font-editorial text-xl font-semibold text-zinc-900">
            2. Qindaa’ina &amp; Qajeelfama Chatbot AI
          </h2>

          {/* Direct File Upload for Chatbot Instructions */}
          <div className="p-4 rounded-xl bg-[#f7f6f2] border border-[#e4e0d8] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-zinc-900">
                Faayila Qajeelfamaa / Odeeffannoo Chatbot Ol-Kaa’i
              </p>
              {settings.instructionFileName && (
                <span className="text-[11px] font-mono text-[#142d4c] truncate max-w-[140px]">
                  {settings.instructionFileName}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-600">
              Qajeelfama ykn odeeffannoo Chatbotiin hordofuu qabu faayila (.pdf, .txt, .md, .csv, .json) irraa kallattiin fe’i.
            </p>
            <label className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[#142d4c] bg-white border border-[#142d4c]/30 rounded-lg hover:bg-[#142d4c]/5 transition-colors cursor-pointer">
              {uploadingInstructionFile ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileUp className="w-3.5 h-3.5" />
              )}
              <span>Faayila Qajeelfamaa Filadhu</span>
              <input
                type="file"
                accept=".pdf,.txt,.md,.csv,.json"
                onChange={handleUploadInstructionFile}
                className="sr-only"
              />
            </label>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="tutor-name" className="block text-xs font-medium text-zinc-700">
                Maqaa Chatbot (Tutor Name)
              </label>
              <input
                id="tutor-name"
                type="text"
                value={settings.tutorName}
                onChange={(e) => setSettings((s) => ({ ...s, tutorName: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white border border-[#e4e0d8] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#142d4c]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="lang-mode" className="block text-xs font-medium text-zinc-700">
                  Afaan Deebii
                </label>
                <select
                  id="lang-mode"
                  value={settings.languageMode}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, languageMode: e.target.value as LanguageMode }))
                  }
                  className="w-full px-3 py-2 text-sm bg-white border border-[#e4e0d8] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#142d4c]"
                >
                  <option value="om">Afaan Oromo</option>
                  <option value="bilingual">Oromo + English</option>
                  <option value="en">English</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="grounding-mode" className="block text-xs font-medium text-zinc-700">
                  Daangaa Madda Deebii
                </label>
                <select
                  id="grounding-mode"
                  value={settings.groundingMode}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      groundingMode: e.target.value as GroundingMode,
                    }))
                  }
                  className="w-full px-3 py-2 text-sm bg-white border border-[#e4e0d8] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#142d4c]"
                >
                  <option value="files_plus_bible">Faayila Admin + Macaafa Qulqulluu</option>
                  <option value="strict_files">Faayila Admin Qofa (Strict)</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="welcome-greeting" className="block text-xs font-medium text-zinc-700">
                Ergaa Simannaa Dashboard (Welcome Message)
              </label>
              <textarea
                id="welcome-greeting"
                rows={2}
                value={settings.welcomeGreeting}
                onChange={(e) => setSettings((s) => ({ ...s, welcomeGreeting: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white border border-[#e4e0d8] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#142d4c]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="system-instructions" className="block text-xs font-medium text-zinc-700">
                Qajeelfama Dabalataa AI (System Instructions)
              </label>
              <textarea
                id="system-instructions"
                rows={3}
                value={settings.systemInstructions}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, systemInstructions: e.target.value }))
                }
                className="w-full px-3 py-2 text-sm bg-white border border-[#e4e0d8] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#142d4c]"
              />
            </div>

            <button
              type="submit"
              disabled={busyAction}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>Qindaa’ina Chatbot Ol-Kaa’i</span>
            </button>
          </form>
        </section>
      </div>

      {/* Uploaded Files Management Table */}
      <section className="sanctuary-card rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#e4e0d8] flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-editorial text-xl font-semibold text-zinc-900">
              3. Faayiloota Barnootaa Ol-Kaa’aman ({documents.length})
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Faayiloonni "Active" ta’an qofti Dashboard barataa fi Chatbot keessatti mul’atu.
            </p>
          </div>

          <div className="inline-flex items-center gap-1 p-1 bg-[#f2efe9] border border-[#e4e0d8] rounded-lg">
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
                onClick={() => setDocTestamentFilter(tab.id)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  docTestamentFilter === tab.id
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#e4e0d8] bg-[#f7f6f2] text-xs font-medium text-zinc-500">
                <th className="py-3 px-4 w-16">Tartiiba</th>
                <th className="py-3 px-4">Mata-Duree &amp; Faayila</th>
                <th className="py-3 px-4">Gosa</th>
                <th className="py-3 px-4 text-right">Hamma</th>
                <th className="py-3 px-4">Haala</th>
                <th className="py-3 px-4 text-right">Gochoota</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 text-sm">
              {documents
                .filter((doc) => {
                  if (docTestamentFilter === 'all') return true;
                  const hay = `${doc.title} ${doc.category} ${doc.summary}`.toLowerCase();
                  return docTestamentFilter === 'old'
                    ? hay.includes('kakuu moofaa')
                    : hay.includes('kakuu haaraa');
                })
                .map((doc) => (
                <tr key={doc.id} className="hover:bg-zinc-50/70">
                  <td className="py-3 px-4 font-mono tabular-nums text-zinc-600">
                    {String(doc.order).padStart(2, '0')}
                  </td>
                  <td className="py-3 px-4">
                    <p className="font-medium text-zinc-900">{doc.title}</p>
                    <p className="text-xs text-zinc-500 font-mono">{doc.fileName}</p>
                  </td>
                  <td className="py-3 px-4 text-xs text-zinc-600">{doc.category}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-zinc-600">
                    {formatBytes(doc.sizeBytes)}
                  </td>
                  <td className="py-3 px-4">
                    {doc.active ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                        <Eye className="w-3.5 h-3.5" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                        <EyeOff className="w-3.5 h-3.5" />
                        Dhokfame
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onPreviewDoc(doc)}
                        className="px-2.5 py-1 text-xs font-medium text-zinc-700 border border-[#e4e0d8] rounded-md hover:bg-[#f2efe9] cursor-pointer"
                      >
                        Ilaali
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(doc)}
                        className="px-2.5 py-1 text-xs font-medium text-zinc-700 border border-[#e4e0d8] rounded-md hover:bg-[#f2efe9] cursor-pointer"
                      >
                        {doc.active ? 'Dhoksi' : 'Mul’isi'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteDoc(doc)}
                        aria-label={`Delete ${doc.title}`}
                        className="p-1.5 text-zinc-500 hover:text-red-600 rounded-md hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {documents.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-zinc-500">
                    Faayilli tokkollee hin jiru. Gara oliitiin faayila haaraa ol-kaa’i.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Admin Credentials + Registered Users */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <section className="lg:col-span-5 sanctuary-card rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-5 h-5 text-[#142d4c]" />
            <h2 className="font-editorial text-xl font-semibold text-zinc-900">
              4. Maqaa fi Password Admin Jijjiiri
            </h2>
          </div>

          <form onSubmit={handleSaveAdminCredentials} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="admin-fullname" className="block text-xs font-medium text-zinc-700">
                Maqaa Guutuu Admin
              </label>
              <input
                id="admin-fullname"
                type="text"
                value={adminFullName}
                onChange={(e) => setAdminFullName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-[#e4e0d8] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#142d4c]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="admin-username" className="block text-xs font-medium text-zinc-700">
                Maqaa Seenumsa Admin (Admin Username)
              </label>
              <input
                id="admin-username"
                type="text"
                required
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-[#e4e0d8] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#142d4c]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="admin-new-pass" className="block text-xs font-medium text-zinc-700">
                Password Admin Haaraa (yoo jijjiiruu barbaadde)
              </label>
              <input
                id="admin-new-pass"
                type="password"
                value={adminNewPassword}
                onChange={(e) => setAdminNewPassword(e.target.value)}
                placeholder="Password haaraa galchi (qubee/lakkoofsa 4+)"
                className="w-full px-3 py-2 text-sm bg-white border border-[#e4e0d8] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#142d4c]"
              />
            </div>

            <button
              type="submit"
              disabled={busyAction}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#142d4c] rounded-lg hover:bg-[#0e2139] transition-colors cursor-pointer disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>Maqaa fi Password Admin Haaromsi</span>
            </button>
          </form>
        </section>

        <section className="lg:col-span-7 sanctuary-card rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#e4e0d8] flex items-center gap-2.5">
            <Users className="w-5 h-5 text-[#142d4c]" />
            <div>
              <h2 className="font-editorial text-xl font-semibold text-zinc-900">
                5. Fayyadamttoota Galmaa’an ({registeredUsers.length})
              </h2>
              <p className="text-xs text-zinc-500">
                Barattoonni yoo password dagatan maqaa (Username) kana fayyadamuun Reset godhu.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#e4e0d8] bg-[#f7f6f2] text-xs font-medium text-zinc-500">
                  <th className="py-3 px-4">Maqaa Guutuu</th>
                  <th className="py-3 px-4">Username</th>
                  <th className="py-3 px-4">Gahee</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 text-sm">
                {registeredUsers.map((u) => (
                  <tr key={u.id}>
                    <td className="py-3 px-4 font-medium text-zinc-900">{u.fullName}</td>
                    <td className="py-3 px-4 font-mono text-xs text-zinc-700">{u.username}</td>
                    <td className="py-3 px-4 text-xs text-zinc-600">
                      {u.role === 'admin' ? 'Admin' : 'Barataa'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
