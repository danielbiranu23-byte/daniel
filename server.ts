import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { GoogleGenAI, Type } from '@google/genai';
import { MongoClient, type Db } from 'mongodb';

interface StudyDocument {
  id: string;
  order: number;
  title: string;
  category: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sourceType: 'upload' | 'lesson' | 'starter';
  active: boolean;
  summary: string;
  textContent: string;
  storedFilePath?: string;
  createdAt: string;
  updatedAt: string;
}

interface AdminSettings {
  tutorName: string;
  welcomeGreeting: string;
  systemInstructions: string;
  instructionFileName?: string;
  instructionPdfPath?: string;
  languageMode: 'om' | 'en' | 'bilingual';
  groundingMode: 'strict_files' | 'files_plus_bible';
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  createdAt: string;
}

interface ChatThread {
  id: string;
  userId: string;
  title: string;
  focusDocId: string | 'all';
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

interface StudentProgress {
  completedDocIds: string[];
  quizScores: Record<string, { score: number; total: number; completedAt: string }>;
}

interface BibleHighlight {
  id: string;
  bookId: string;
  omName: string;
  enName: string;
  chapter: number;
  verse: number;
  omText: string;
  enText: string;
  color: 'yellow' | 'blue' | 'green' | 'rose';
  note?: string;
  savedAt: string;
}

interface UserAccount {
  id: string;
  username: string;
  fullName: string;
  role: 'admin' | 'user';
  passwordHash: string;
  progress: StudentProgress;
  highlights?: BibleHighlight[];
  createdAt: string;
}

interface SessionRecord {
  userId: string;
  createdAt: string;
}

interface StoreData {
  settings: AdminSettings;
  documents: StudyDocument[];
  chats: ChatThread[];
  progress: StudentProgress;
  users: UserAccount[];
  sessions: Record<string, SessionRecord>;
  bibleSeeded?: boolean;
}

interface BibleChapterEntry {
  numberOfVerses: number;
  chapter: {
    number: number;
    content: Array<{
      type: string;
      number?: number;
      content?: Array<string | { text?: string; noteId?: number }>;
    }>;
  };
}

interface BibleBook {
  id: string;
  name: string;
  commonName?: string;
  shortName?: string;
  title?: string;
  order: number;
  numberOfChapters: number;
  totalNumberOfVerses: number;
  chapters: BibleChapterEntry[];
}

interface BibleDataset {
  translation?: {
    id: string;
    name: string;
    englishName?: string;
    licenseUrl?: string;
  };
  books: BibleBook[];
}

const PORT = Number(process.env.PORT) || 3000;
const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = IS_VERCEL
  ? path.join('/tmp', 'qajeelcha_data')
  : path.resolve(process.cwd(), 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const BIBLE_DIR = path.resolve(process.cwd(), 'data', 'bible');
const OROMO_BIBLE_PATH = path.join(BIBLE_DIR, 'gaz_bib.json');
const ENGLISH_BIBLE_PATH = path.join(BIBLE_DIR, 'eng_webp.json');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!IS_VERCEL) {
  fs.mkdirSync(BIBLE_DIR, { recursive: true });
}

let cachedBibleDatasets: { om: BibleDataset | null; en: BibleDataset | null } | null = null;

function loadBibleDatasets(): { om: BibleDataset | null; en: BibleDataset | null } {
  if (cachedBibleDatasets) {
    return cachedBibleDatasets;
  }
  let om: BibleDataset | null = null;
  let en: BibleDataset | null = null;
  try {
    if (fs.existsSync(OROMO_BIBLE_PATH)) {
      om = JSON.parse(fs.readFileSync(OROMO_BIBLE_PATH, 'utf8')) as BibleDataset;
    }
  } catch {
    om = null;
  }
  try {
    if (fs.existsSync(ENGLISH_BIBLE_PATH)) {
      en = JSON.parse(fs.readFileSync(ENGLISH_BIBLE_PATH, 'utf8')) as BibleDataset;
    }
  } catch {
    en = null;
  }
  if (om || en) {
    cachedBibleDatasets = { om, en };
  }
  return { om, en };
}

function extractBibleContentText(
  content?: Array<string | { text?: string; noteId?: number }>
): string {
  if (!Array.isArray(content)) return '';
  const pieces: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      pieces.push(part);
    } else if (part && typeof part === 'object' && typeof part.text === 'string') {
      pieces.push(part.text);
    }
  }
  return pieces.join(' ').replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}

function formatBibleBookMarkdown(
  omBook: BibleBook | undefined,
  enBook: BibleBook | undefined,
  language: 'bilingual' | 'om' | 'en'
): string {
  const omName = omBook?.name || enBook?.name || '';
  const enName = enBook?.name || omBook?.name || '';
  const heading =
    language === 'bilingual'
      ? `# ${omName} (${enName}) — Afaan Oromo & English`
      : language === 'om'
        ? `# ${omName} — Macaafa Qulqulluu (Afaan Oromo)`
        : `# ${enName} — Holy Bible (World English Bible)`;

  const lines: string[] = [
    heading,
    '',
    '_Macaafa Qulqulluu Bilisaa (100% Free Open License: Kitaaba Qulqulluu Hiikkaa Ammayyaa Banamaa Haaraa & World English Bible)_',
    '',
  ];

  const totalChapters = Math.max(omBook?.chapters.length || 0, enBook?.chapters.length || 0);
  for (let i = 0; i < totalChapters; i++) {
    const omCh = omBook?.chapters[i];
    const enCh = enBook?.chapters[i];
    const chNum = omCh?.chapter?.number ?? enCh?.chapter?.number ?? i + 1;

    if (language === 'bilingual') {
      lines.push(`## Boqonnaa ${chNum} / Chapter ${chNum}`);
    } else if (language === 'om') {
      lines.push(`## Boqonnaa ${chNum}`);
    } else {
      lines.push(`## Chapter ${chNum}`);
    }
    lines.push('');

    const omVerses = new Map<number, string>();
    if (omCh?.chapter?.content) {
      for (const item of omCh.chapter.content) {
        if (item.type === 'verse' && typeof item.number === 'number') {
          const txt = extractBibleContentText(item.content);
          if (txt) omVerses.set(item.number, txt);
        }
      }
    }

    const enVerses = new Map<number, string>();
    if (enCh?.chapter?.content) {
      for (const item of enCh.chapter.content) {
        if (item.type === 'verse' && typeof item.number === 'number') {
          const txt = extractBibleContentText(item.content);
          if (txt) enVerses.set(item.number, txt);
        }
      }
    }

    const verseNums = Array.from(new Set([...omVerses.keys(), ...enVerses.keys()])).sort(
      (a, b) => a - b
    );
    for (const vNum of verseNums) {
      const omText = omVerses.get(vNum) || '';
      const enText = enVerses.get(vNum) || '';
      if (language === 'bilingual') {
        if (omText && enText) {
          lines.push(`**${vNum}.** ${omText}`);
          lines.push(`> *${enText}*`);
        } else {
          lines.push(`**${vNum}.** ${omText || enText}`);
        }
      } else if (language === 'om') {
        if (omText) lines.push(`**${vNum}.** ${omText}`);
      } else {
        if (enText) lines.push(`**${vNum}.** ${enText}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

const BIBLE_BOOK_ALIASES: Array<{ id: string; terms: string[] }> = [
  { id: 'GEN', terms: ['uumama', 'seera uumamaa', 'genesis', 'gen'] },
  { id: 'EXO', terms: ['ba uu', 'seera ba uu', 'exodus', 'exo'] },
  { id: 'LEV', terms: ['leewota', 'seera leewotaa', 'leviticus', 'lev'] },
  { id: 'NUM', terms: ['lakkoofsa', 'seera lakkoofsaa', 'numbers', 'num'] },
  { id: 'DEU', terms: ['keessa deebii', 'deuteronomy', 'deut', 'deu'] },
  { id: 'JOS', terms: ['iyaasuu', 'joshua', 'jos'] },
  { id: 'JDG', terms: ['abboota firdii', 'judges', 'jdg'] },
  { id: 'RUT', terms: ['ruut', 'ruth', 'rut'] },
  { id: '1SA', terms: ['1 saamu eel', '1 samuel', '1sa'] },
  { id: '2SA', terms: ['2 saamu eel', '2 samuel', '2sa'] },
  { id: '1KI', terms: ['1 mootota', '1 kings', '1ki'] },
  { id: '2KI', terms: ['2 mootota', '2 kings', '2ki'] },
  { id: '1CH', terms: ['1 seenaa baraa', '1 chronicles', '1ch'] },
  { id: '2CH', terms: ['2 seenaa baraa', '2 chronicles', '2ch'] },
  { id: 'EZR', terms: ['izraa', 'ezra', 'ezr'] },
  { id: 'NEH', terms: ['nehemiyaa', 'nehemiah', 'neh'] },
  { id: 'EST', terms: ['asteer', 'esther', 'est'] },
  { id: 'JOB', terms: ['iyoob', 'job'] },
  { id: 'PSA', terms: ['faarfannaa', 'farfanna', 'faarf', 'faar', 'psalm', 'psalms', 'psa'] },
  { id: 'PRO', terms: ['fakkeenya', 'fakk', 'proverbs', 'prov', 'pro'] },
  { id: 'ECC', terms: ['lallaba', 'ecclesiastes', 'ecc'] },
  { id: 'SNG', terms: ['weedduu', 'song of solomon', 'song of songs', 'sng'] },
  { id: 'ISA', terms: ['isaayaas', 'isaayas', 'isa', 'isaiah'] },
  { id: 'JER', terms: ['ermiyaas', 'ermiyas', 'jeremiah', 'jer'] },
  { id: 'LAM', terms: ['faaruu ermiyaas', 'lamentations', 'lam'] },
  { id: 'EZK', terms: ['hisqi eel', 'ezekiel', 'ezk'] },
  { id: 'DAN', terms: ['daani eel', 'daniel', 'dan'] },
  { id: 'HOS', terms: ['hoosee', 'hosea', 'hos'] },
  { id: 'JOL', terms: ['yoo el', 'joel', 'jol'] },
  { id: 'AMO', terms: ['amoos', 'amos', 'amo'] },
  { id: 'OBA', terms: ['obaadiyaa', 'obadiah', 'oba'] },
  { id: 'JON', terms: ['yoonaas', 'jonah', 'jon'] },
  { id: 'MIC', terms: ['miikiyaas', 'micah', 'mic'] },
  { id: 'NAM', terms: ['nahuum', 'nahum', 'nam'] },
  { id: 'HAB', terms: ['inbaaqom', 'habakkuk', 'hab'] },
  { id: 'ZEP', terms: ['sefaniyaa', 'zephaniah', 'zep'] },
  { id: 'HAG', terms: ['haagaay', 'haggai', 'hag'] },
  { id: 'ZEC', terms: ['zakkaariyaas', 'zechariah', 'zec'] },
  { id: 'MAL', terms: ['milaaki', 'malachi', 'mal'] },
  { id: 'MAT', terms: ['maatewos', 'matewos', 'maat', 'mat', 'matthew', 'matt'] },
  { id: 'MRK', terms: ['maarqoos', 'marqos', 'maarq', 'mark', 'mrk'] },
  { id: 'LUK', terms: ['luqaas', 'luqas', 'luq', 'luke', 'luk'] },
  { id: 'JHN', terms: ['yohaannis', 'yohannis', 'yohannes', 'yohn', 'yoh', 'john', 'jhn'] },
  { id: 'ACT', terms: ['hojii ergamootaa', 'hojii', 'acts', 'act'] },
  { id: 'ROM', terms: ['roomaa', 'romaa', 'rom', 'romans'] },
  { id: '1CO', terms: ['1 qorontos', '1 qor', '1 corinthians', '1co'] },
  { id: '2CO', terms: ['2 qorontos', '2 qor', '2 corinthians', '2co'] },
  { id: 'GAL', terms: ['galaatiyaa', 'galatiya', 'gal', 'galatians'] },
  { id: 'EPH', terms: ['efesoon', 'efeson', 'efe', 'ephesians', 'eph'] },
  { id: 'PHP', terms: ['filiphisiyus', 'fil', 'philippians', 'php'] },
  { id: 'COL', terms: ['qolosaayis', 'qol', 'colossians', 'col'] },
  { id: '1TH', terms: ['1 tasalonqee', '1 thessalonians', '1th'] },
  { id: '2TH', terms: ['2 tasalonqee', '2 thessalonians', '2th'] },
  { id: '1TI', terms: ['1 ximootewos', '1 xim', '1 timothy', '1ti'] },
  { id: '2TI', terms: ['2 ximootewos', '2 xim', '2 timothy', '2ti'] },
  { id: 'TIT', terms: ['tiitoo', 'titus', 'tit'] },
  { id: 'PHM', terms: ['filemoon', 'philemon', 'phm'] },
  { id: 'HEB', terms: ['ibroota', 'ibrota', 'ibr', 'hebrews', 'heb'] },
  { id: 'JAS', terms: ['yaaqoob', 'yaqob', 'yaaq', 'james', 'jas'] },
  { id: '1PE', terms: ['1 phexros', '1 peter', '1pe'] },
  { id: '2PE', terms: ['2 phexros', '2 peter', '2pe'] },
  { id: '1JN', terms: ['1 yohaannis', '1 yohannis', '1 john', '1jn'] },
  { id: '2JN', terms: ['2 yohaannis', '2 yohannis', '2 john', '2jn'] },
  { id: '3JN', terms: ['3 yohaannis', '3 yohannis', '3 john', '3jn'] },
  { id: 'JUD', terms: ['yihudaa', 'jude', 'jud'] },
  { id: 'REV', terms: ['mul ata', 'mulata', 'mul', 'revelation', 'rev'] },
];

function normalizeSearchStr(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9:\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchBibleForQuery(query: string): string {
  const { om, en } = loadBibleDatasets();
  if (!om && !en) return '';

  const normQuery = normalizeSearchStr(query);
  if (!normQuery) return '';

  const omById = new Map((om?.books || []).map((b) => [b.id, b]));
  const enById = new Map((en?.books || []).map((b) => [b.id, b]));
  const allBookIds = Array.from(new Set([...omById.keys(), ...enById.keys()]));

  // 1. Check for direct book + chapter(:verse) reference
  let matchedBookId: string | null = null;
  for (const id of allBookIds) {
    const omB = omById.get(id);
    const enB = enById.get(id);
    const candidates = [
      omB?.name,
      omB?.commonName,
      omB?.shortName,
      enB?.name,
      enB?.commonName,
      enB?.shortName,
    ]
      .filter((s): s is string => Boolean(s))
      .map(normalizeSearchStr);

    const aliasEntry = BIBLE_BOOK_ALIASES.find((a) => a.id === id);
    if (aliasEntry) {
      candidates.push(...aliasEntry.terms);
    }

    for (const term of candidates) {
      if (term.length >= 3 && new RegExp(`(^|\\s)${term}(\\s|$)`).test(normQuery)) {
        matchedBookId = id;
        break;
      }
    }
    if (matchedBookId) break;
  }

  const snippets: string[] = [];

  if (matchedBookId) {
    const omBook = omById.get(matchedBookId);
    const enBook = enById.get(matchedBookId);
    const refMatch = normQuery.match(/\b(\d{1,3})(?:\s*:\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?)?\b/);
    const chapterNum = refMatch ? Number(refMatch[1]) : 1;
    const verseStart = refMatch?.[2] ? Number(refMatch[2]) : null;
    const verseEnd = refMatch?.[3] ? Number(refMatch[3]) : verseStart;

    const omCh = omBook?.chapters.find((c) => c.chapter.number === chapterNum);
    const enCh = enBook?.chapters.find((c) => c.chapter.number === chapterNum);

    if (omCh || enCh) {
      const omMap = new Map<number, string>();
      for (const item of omCh?.chapter.content || []) {
        if (item.type === 'verse' && typeof item.number === 'number') {
          omMap.set(item.number, extractBibleContentText(item.content));
        }
      }
      const enMap = new Map<number, string>();
      for (const item of enCh?.chapter.content || []) {
        if (item.type === 'verse' && typeof item.number === 'number') {
          enMap.set(item.number, extractBibleContentText(item.content));
        }
      }

      const allNums = Array.from(new Set([...omMap.keys(), ...enMap.keys()])).sort((a, b) => a - b);
      const selectedNums = verseStart
        ? allNums.filter((n) => n >= Math.max(1, verseStart - 1) && n <= (verseEnd || verseStart) + 2)
        : allNums.slice(0, 50);

      for (const v of selectedNums) {
        const omT = omMap.get(v) || '';
        const enT = enMap.get(v) || '';
        snippets.push(
          `${omBook?.name || ''} (${enBook?.name || ''}) ${chapterNum}:${v}\n- Afaan Oromo: ${omT}\n- English: ${enT}`
        );
      }
    }
  }

  // 2. Keyword search across all 66 books if no explicit reference matched or to add supporting verses
  if (snippets.length === 0) {
    const stopWords = new Set([
      'maal', 'maali', 'eenyu', 'akkam', 'yoom', 'eessa', 'waa', 'ee', 'irratti', 'keessatti',
      'kessatti', 'fi', 'ykn', 'kan', 'isa', 'isaa', 'koo', 'kee', 'naaf', 'nuuf', 'itti',
      'iraa', 'akka', 'qaba', 'jira', 'ta', 'what', 'who', 'how', 'when', 'where', 'why',
      'the', 'and', 'for', 'with', 'about', 'from', 'that', 'this', 'bible', 'macaafa',
      'qulqulluu', 'afaan', 'oromo', 'english', 'luqqisii', 'verse', 'scripture',
    ]);
    const keywords = normQuery
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !stopWords.has(w))
      .slice(0, 5);

    if (keywords.length > 0) {
      const scored: Array<{ score: number; text: string }> = [];
      for (const id of allBookIds) {
        const omBook = omById.get(id);
        const enBook = enById.get(id);
        const maxCh = Math.max(omBook?.chapters.length || 0, enBook?.chapters.length || 0);
        for (let ci = 0; ci < maxCh; ci++) {
          const omCh = omBook?.chapters[ci];
          const enCh = enBook?.chapters[ci];
          const chNum = omCh?.chapter.number ?? enCh?.chapter.number ?? ci + 1;

          const omMap = new Map<number, string>();
          for (const item of omCh?.chapter.content || []) {
            if (item.type === 'verse' && typeof item.number === 'number') {
              omMap.set(item.number, extractBibleContentText(item.content));
            }
          }
          const enMap = new Map<number, string>();
          for (const item of enCh?.chapter.content || []) {
            if (item.type === 'verse' && typeof item.number === 'number') {
              enMap.set(item.number, extractBibleContentText(item.content));
            }
          }

          for (const vNum of omMap.keys()) {
            const omText = omMap.get(vNum) || '';
            const enText = enMap.get(vNum) || '';
            const combined = `${omText} ${enText}`.toLowerCase();
            let hits = 0;
            for (const kw of keywords) {
              if (combined.includes(kw)) hits++;
            }
            if (hits > 0) {
              scored.push({
                score: hits,
                text: `${omBook?.name || ''} (${enBook?.name || ''}) ${chNum}:${vNum}\n- Afaan Oromo: ${omText}\n- English: ${enText}`,
              });
            }
          }
        }
      }
      scored.sort((a, b) => b.score - a.score);
      for (const item of scored.slice(0, 10)) {
        snippets.push(item.text);
      }
    }
  }

  // 3. If the user asks about Kakuu Moofaa (Old Testament) or Kakuu Haaraa (New Testament) books
  const wantsOld = /\b(kakuu\s+moofaa|old\s+testament)\b/.test(normQuery);
  const wantsNew = /\b(kakuu\s+haaraa|kakuu\s+haraa|new\s+testament)\b/.test(normQuery);
  if (wantsOld || wantsNew) {
    const orderedIds = allBookIds.sort((a, b) => {
      const ordA = omById.get(a)?.order || enById.get(a)?.order || 99;
      const ordB = omById.get(b)?.order || enById.get(b)?.order || 99;
      return ordA - ordB;
    });
    if (wantsOld) {
      const oldList = orderedIds
        .filter((id) => (omById.get(id)?.order || enById.get(id)?.order || 99) <= 39)
        .map((id) => `${omById.get(id)?.order || ''}. ${omById.get(id)?.name || id} (${enById.get(id)?.name || id})`)
        .join(', ');
      snippets.push(`Kakuu Moofaa (Old Testament — 39 Books): ${oldList}`);
    }
    if (wantsNew) {
      const newList = orderedIds
        .filter((id) => (omById.get(id)?.order || enById.get(id)?.order || 0) > 39)
        .map((id) => `${omById.get(id)?.order || ''}. ${omById.get(id)?.name || id} (${enById.get(id)?.name || id})`)
        .join(', ');
      snippets.push(`Kakuu Haaraa (New Testament — 27 Books): ${newList}`);
    }
  }

  if (snippets.length === 0) return '';
  return `--- BILINGUAL BIBLE PASSAGES (AFAAN OROMO & ENGLISH) ---\n${snippets.join('\n\n')}\n--- END OF BIBLE PASSAGES ---`;
}

function buildOfflineChatbotReply(
  query: string,
  targetDocs: StudyDocument[],
  bibleContext: string,
  userFullName: string
): string {
  const norm = normalizeSearchStr(query);
  const firstName = userFullName.split(' ')[0] || 'Michuu';

  const isGreeting =
    /^(akkam|akkam jirtu|akkam jirta|selam|salaam|nagaan|nagaa|naguma|hello|hi|hey|good morning|good afternoon|galatoomi|galatomi|thank you|thanks)\b/.test(
      norm
    ) && norm.split(/\s+/).length <= 5;

  if (isGreeting) {
    return `Nagaan Waaqayyoo siif haa baay'atu, ${firstName}! Akkam jirta? Gaaffii Barnoota Macaafa Qulqulluu yookiin luqqisii Afaan Oromo fi English dhaan barbaadde na gaafachuu dandeessa; gammachuudhaan si gargaaruuf qophaa'aa dha.`;
  }

  const parts: string[] = [];

  if (bibleContext) {
    const cleaned = bibleContext
      .replace(/^--- BILINGUAL BIBLE PASSAGES \(AFAAN OROMO & ENGLISH\) ---\n?/m, '')
      .replace(/\n?--- END OF BIBLE PASSAGES ---$/m, '')
      .trim();
    if (cleaned) {
      parts.push(`Kunoo sagalee Macaafa Qulqulluu Afaan Oromo fi English dhaan:\n\n${cleaned}`);
    }
  }

  // Search Admin study documents by paragraph/section overlap
  const stopWords = new Set([
    'maal', 'maali', 'eenyu', 'akkam', 'yoom', 'eessa', 'irratti', 'keessatti',
    'kessatti', 'fi', 'ykn', 'kan', 'isa', 'isaa', 'naaf', 'nuuf', 'akka', 'jira',
    'what', 'who', 'how', 'when', 'where', 'why', 'the', 'and', 'for', 'with',
    'about', 'from', 'that', 'this', 'afaan', 'oromo', 'english', 'lamaaniin',
  ]);
  const keywords = norm.split(/\s+/).filter((w) => w.length >= 3 && !stopWords.has(w));

  if (keywords.length > 0 && targetDocs.length > 0) {
    const docMatches: Array<{ score: number; snippet: string }> = [];
    for (const doc of targetDocs) {
      if (!doc.textContent) continue;
      const sections = doc.textContent.split(/\n{2,}/).filter((s) => s.trim().length > 20);
      for (const sec of sections) {
        const lower = sec.toLowerCase();
        let score = 0;
        for (const kw of keywords) {
          if (lower.includes(kw)) score++;
        }
        if (score > 0) {
          docMatches.push({ score, snippet: sec.trim().slice(0, 900) });
        }
      }
    }
    docMatches.sort((a, b) => b.score - a.score);
    if (docMatches.length > 0) {
      const topExcerpts = docMatches
        .slice(0, 3)
        .map((m) => m.snippet)
        .join('\n\n');
      parts.push(topExcerpts);
    }
  }

  if (parts.length > 0) {
    return parts.join('\n\n');
  }

  return "Odeeffannoon hin jire, ammaaf isiniif deebisuu hin dandeenye; maaloo nagaan Waaqayyoo siif haa baay'atu! Eebbifami!";
}

let cachedOfflineBundleJson: string | null = null;
function getOfflineBibleBundleJson(): string {
  if (cachedOfflineBundleJson) return cachedOfflineBundleJson;
  const { om, en } = loadBibleDatasets();
  const omById = new Map((om?.books || []).map((b) => [b.id, b]));
  const enById = new Map((en?.books || []).map((b) => [b.id, b]));
  const ids = Array.from(new Set([...omById.keys(), ...enById.keys()])).sort((a, b) => {
    const ordA = omById.get(a)?.order || enById.get(a)?.order || 99;
    const ordB = omById.get(b)?.order || enById.get(b)?.order || 99;
    return ordA - ordB;
  });

  const books = ids.map((id) => {
    const omBook = omById.get(id);
    const enBook = enById.get(id);
    const order = omBook?.order || enBook?.order || 1;
    const maxCh = Math.max(omBook?.chapters.length || 0, enBook?.chapters.length || 0);
    const chapters: Array<{ n: number; v: Array<[number, string, string]> }> = [];

    for (let ci = 0; ci < maxCh; ci++) {
      const omCh = omBook?.chapters[ci];
      const enCh = enBook?.chapters[ci];
      const chNum = omCh?.chapter.number ?? enCh?.chapter.number ?? ci + 1;
      const omMap = new Map<number, string>();
      for (const item of omCh?.chapter.content || []) {
        if (item.type === 'verse' && typeof item.number === 'number') {
          omMap.set(item.number, extractBibleContentText(item.content));
        }
      }
      const enMap = new Map<number, string>();
      for (const item of enCh?.chapter.content || []) {
        if (item.type === 'verse' && typeof item.number === 'number') {
          enMap.set(item.number, extractBibleContentText(item.content));
        }
      }
      const nums = Array.from(new Set([...omMap.keys(), ...enMap.keys()])).sort((a, b) => a - b);
      chapters.push({
        n: chNum,
        v: nums.map((num) => [num, omMap.get(num) || '', enMap.get(num) || '']),
      });
    }

    return {
      id,
      order,
      omName: omBook?.name || enBook?.name || id,
      enName: enBook?.name || omBook?.name || id,
      testament: order <= 39 ? 'old' : 'new',
      chapters,
    };
  });

  cachedOfflineBundleJson = JSON.stringify({ books });
  return cachedOfflineBundleJson;
}

function createBibleStudyDocument(
  bookId: string,
  language: 'bilingual' | 'om' | 'en',
  order: number,
  category?: string
): StudyDocument | null {
  const { om, en } = loadBibleDatasets();
  const upperId = bookId.toUpperCase();
  const omBook = om?.books.find((b) => b.id === upperId);
  const enBook = en?.books.find((b) => b.id === upperId);
  if (!omBook && !enBook) return null;

  const markdown = formatBibleBookMarkdown(omBook, enBook, language);
  const langSuffix = language === 'bilingual' ? 'Oromo & English' : language === 'om' ? 'Afaan Oromo' : 'English';
  const baseName = `${upperId.toLowerCase()}_${language}_bible.md`;
  const savedFilePath = path.join(UPLOADS_DIR, baseName);
  fs.writeFileSync(savedFilePath, markdown, 'utf8');

  const now = new Date().toISOString();
  const title =
    language === 'bilingual'
      ? `Macaafa Qulqulluu: ${omBook?.name || upperId} (${enBook?.name || upperId}) — Oromo & English`
      : language === 'om'
        ? `Macaafa Qulqulluu: ${omBook?.name || upperId} (Afaan Oromo)`
        : `Holy Bible: ${enBook?.name || upperId} (English)`;

  const testamentLabel = (omBook?.order || enBook?.order || 1) <= 39 ? 'Kakuu Moofaa' : 'Kakuu Haaraa';
  return {
    id: `doc-bible-${upperId.toLowerCase()}-${language}`,
    order,
    title,
    category: category?.trim() || `${testamentLabel} (${langSuffix})`,
    fileName: baseName,
    mimeType: 'text/markdown',
    sizeBytes: Buffer.byteLength(markdown, 'utf8'),
    sourceType: 'upload',
    active: true,
    summary: `Macaafa ${omBook?.name || ''} (${enBook?.name || ''}) boqonnaa ${omBook?.numberOfChapters || enBook?.numberOfChapters || 1} — ${langSuffix} (Free Open License).`,
    textContent: markdown,
    storedFilePath: savedFilePath,
    createdAt: now,
    updatedAt: now,
  };
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function createStarterStore(): StoreData {
  const now = new Date().toISOString();
  const starterDocs: StudyDocument[] = [
    {
      id: 'doc-seensa-macaafa',
      order: 1,
      title: 'Boqonnaa 1: Seensa Macaafa Qulqulluu fi Kakuu Moofaa',
      category: 'Bu’uura Barnootaa',
      fileName: 'boqonnaa_01_seensa_macaafa_qulqulluu.md',
      mimeType: 'text/markdown',
      sizeBytes: 2450,
      sourceType: 'starter',
      active: true,
      summary:
        'Caasaa Macaafa Qulqulluu (kitaabota 66), garaagarummaa Kakuu Moofaa fi Kakuu Haaraa, fi ergaa guddaa Waaqayyo namaaf kenne.',
      textContent: `# Boqonnaa 1: Seensa Macaafa Qulqulluu fi Kakuu Moofaa

## 1. Maalummaa Macaafa Qulqulluu
Macaafni Qulqulluun sagalee Waaqayyoo isa namoota qulqullootaan hafuura Waaqayyootiin geggeeffamanii barreeffameedha (2 Ximootewos 3:16). Kitaabota walitti qabaman **66** irraa ijaarame:
- **Kakuu Moofaa (Old Testament)**: Kitaabota **39** of keessaa qaba. Seenaa uumamaa (Seera Uumamaa), seera Muusee, seenaa saba Israa'el, faarfannaa (Faarfannaa Daawit), fi raajota gurguddaa fi xixiqqoo qabata.
- **Kakuu Haaraa (New Testament)**: Kitaabota **27** of keessaa qaba. Wangeelota arfan (Maatewos, Maarqos, Luqaas, Yohaannis), Hojii Ergamootaa, Xalayoota Phaawulosii fi ergamoota biroo, akkasumas Mul'ata Yohaannis qabata.

## 2. Kaayyoo Guddaa Kakuu Moofaa
Kakuun Moofaan:
1. Waaqayyo Uumaa waan hundumaa ta'uu isaa barsiisa (Seera Uumamaa 1:1).
2. Cubbuun akkamitti addunyaatti akka seenee fi kufaatii namaa ibsa (Seera Uumamaa 3).
3. Kakuu Waaqayyo Abrahaamii fi sanyii isaa waliin gale agarsiisa (Seera Uumamaa 12:1-3).
4. Abdii Fayyisaa (Masiihii) dhufuuf jiruu raajota keessatti dubbata (Isaayaas 53).

## 3. Luqqisii Ijoo Qo'annoo
- **2 Ximootewos 3:16**: "Caaffanni qulqullaa'aan hundinuu hafuura Waaqayyootiin caafame; barsiisuuf, balleessaa hubachiisuuf, qajeelchuuf, qajeelummaattis guddisuuf dhimma in baasa."
- **Faarfannaa 119:105**: "Dubbiin kee miilla kootiif ibsaa dha, daandii koo irrattis ifa dha."`,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'doc-wangeela-kakuu-haaraa',
      order: 2,
      title: 'Boqonnaa 2: Wangeelaa fi Ergaa Kakuu Haaraa',
      category: 'Kakuu Haaraa',
      fileName: 'boqonnaa_02_wangeela_fi_fayyina.md',
      mimeType: 'text/markdown',
      sizeBytes: 2290,
      sourceType: 'starter',
      active: true,
      summary:
        'Dhaloota, barsiisa, du’aa fi du’aa ka’uu Yesus Kiristoos akkasumas fayyina ayyaanaan argamu.',
      textContent: `# Boqonnaa 2: Wangeelaa fi Ergaa Kakuu Haaraa

## 1. Wangeela jechuun maal jechuudha?
Jechi "Wangeela" jedhu **Misiraachoo (Good News)** jechuudha. Kunis misiraachoo fayyinaa isa karaa Yesus Kiristoos dhufe ibsa.

## 2. Wangeelota Arfan
- **Maatewos**: Yesus Kiristoos Mootii fi Masiihii abdachiifame ta'uu isaa xiyyeeffata.
- **Maarqos**: Yesus Tajaajilaa humna qabeessaa fi dinqii hojjetu ta'uu isaa gabaabsee dhiyeessa.
- **Luqaas**: Yesus Fayyisaa namoota hundumaa, keessattuu hiyyeeyyii fi warra dagatamanii ta'uu isaa ibsa.
- **Yohaannis**: Yesus Ilma Waaqayyoo fi Sagalee foon uffate ta'uu isaa mul'isa (Yohaannis 1:1, 14).

## 3. Utubaawwan Fayyinaa
1. **Jaalala Waaqayyoo**: Waaqayyo hammam addunyaa akka jaallate (Yohaannis 3:16).
2. **Ayyaanaa fi Amantii**: Fayyinni hojii keenyaan osoo hin taane, ayyaana Waaqayyootiin karaa amantii kennama (Efesoon 2:8-9).
3. **Du'aa Ka'uu fi Abdii**: Du'aa ka'uun Kiristoos amantootaaf jireenya haaraa fi abdii bara baraa mirkaneessa (1 Qorontos 15:3-4).`,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'doc-kadhannaa-amantii',
      order: 3,
      title: 'Boqonnaa 3: Kadhannaa, Amantii fi Jireenya Guyyaa Guyyaa',
      category: 'Guddina Hafuuraa',
      fileName: 'boqonnaa_03_kadhannaa_fi_amantii.md',
      mimeType: 'text/markdown',
      sizeBytes: 2150,
      sourceType: 'starter',
      active: true,
      summary:
        'Akkaataa kadhannaa Yesus barsiise (Maatewos 6), ija hafuuraa (Galaatiyaa 5), fi hojiirra oolmaa sagalee Waaqayyoo.',
      textContent: `# Boqonnaa 3: Kadhannaa, Amantii fi Jireenya Guyyaa Guyyaa

## 1. Kadhannaa Maali?
Kadhannaan Waaqayyo waliin haasa'uu fi yaada garaa keenyaa isa duratti dhiyeessuudha. Yesus bartoota isaatiif fakkeenya kadhannaa kenneera (Maatewos 6:9-13):
- Galataa fi ulfina Waaqayyoof kennuu ("Maqaan kee haa qulqullaa'u").
- Jaalala Waaqayyoo barbaaduu ("Jaalalli kee lafa irratti haa ta'u").
- Waan guyyaa guyyaaf barbaachisu gaafachuu ("Buddeena keenya kan har'aa nuuf kenni").
- Dhiifamaa fi eegumsa kadhachuu.

## 2. Amantii fi Hojii
Amantiin dhugaan hojiin mul'ata (Yaaqoob 2:17). Amantiin waan abdatamu mirkaneeffachuu fi waan hin argamne dhugaa ta'uu isaa amanuu dha (Ibroota 11:1).

## 3. Ija Hafuura Qulqulluu (Galaatiyaa 5:22-23)
Jireenyi Kiristaanaa ija hafuuraatiin beekama:
- Jaalala, gammachuu, nagaa
- Obsa, gaarummaa, arjummaa
- Amanamummaa, garraamummaa, of qabuu`,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const defaultAdmin: UserAccount = {
    id: 'user-admin-default',
    username: 'admin',
    fullName: 'Admin Giddugalaa',
    role: 'admin',
    passwordHash: hashPassword('admin123'),
    progress: { completedDocIds: [], quizScores: {} },
    createdAt: now,
  };

  const defaultStudent: UserAccount = {
    id: 'user-student-default',
    username: 'barataa',
    fullName: 'Barataa Macaafaa',
    role: 'user',
    passwordHash: hashPassword('barataa123'),
    progress: { completedDocIds: [], quizScores: {} },
    createdAt: now,
  };

  return {
    settings: {
      tutorName: 'Barsiisaa Macaafaa AI',
      welcomeGreeting:
        'Akkam jirtu! Ani gargaaraa kee Barnoota Macaafa Qulqulluu ti. Faayiloota Adminiin qopheesse irratti hundaa’uun boqonnaa jalqabaa hanga xummuraatti sin qajeelcha.',
      systemInstructions:
        'Barnoota Macaafa Qulqulluu irratti barattoota waliin akka namaatti haasaa ho’aa fi ifaa ta’e taasisi. Odeeffannoo sirrii fi qulqulluu qofa kenni; maqaa faayilaa irra deddeebitee hin waamin.',
      languageMode: 'om',
      groundingMode: 'strict_files',
    },
    documents: starterDocs,
    chats: [],
    progress: {
      completedDocIds: [],
      quizScores: {},
    },
    users: [defaultAdmin, defaultStudent],
    sessions: {},
  };
}

let cachedStore: StoreData | null = null;
let mongoClient: MongoClient | null = null;
let mongoDb: Db | null = null;
let mongoSyncChain: Promise<void> = Promise.resolve();

function cloneStore(store: StoreData): StoreData {
  return JSON.parse(JSON.stringify(store)) as StoreData;
}

async function syncStoreToMongo(snapshot: StoreData): Promise<void> {
  if (!mongoDb) return;
  try {
    const settingsCol = mongoDb.collection<AdminSettings & { _id: string }>('app_settings');
    await settingsCol.replaceOne(
      { _id: 'global' },
      { ...snapshot.settings },
      { upsert: true }
    );

    const docsCol = mongoDb.collection<StudyDocument & { _id: string }>('study_documents');
    const docIds = snapshot.documents.map((d) => d.id);
    if (docIds.length > 0) {
      await docsCol.bulkWrite(
        snapshot.documents.map((d) => ({
          replaceOne: {
            filter: { _id: d.id },
            replacement: { ...d },
            upsert: true,
          },
        }))
      );
      await docsCol.deleteMany({ _id: { $nin: docIds } });
    } else {
      await docsCol.deleteMany({});
    }

    const usersCol = mongoDb.collection<UserAccount & { _id: string }>('users');
    const userIds = snapshot.users.map((u) => u.id);
    if (userIds.length > 0) {
      await usersCol.bulkWrite(
        snapshot.users.map((u) => ({
          replaceOne: {
            filter: { _id: u.id },
            replacement: { ...u },
            upsert: true,
          },
        }))
      );
      await usersCol.deleteMany({ _id: { $nin: userIds } });
    } else {
      await usersCol.deleteMany({});
    }

    const chatsCol = mongoDb.collection<ChatThread & { _id: string }>('chat_threads');
    const chatIds = snapshot.chats.map((c) => c.id);
    if (chatIds.length > 0) {
      await chatsCol.bulkWrite(
        snapshot.chats.map((c) => ({
          replaceOne: {
            filter: { _id: c.id },
            replacement: { ...c },
            upsert: true,
          },
        }))
      );
      await chatsCol.deleteMany({ _id: { $nin: chatIds } });
    } else {
      await chatsCol.deleteMany({});
    }

    const sessionsCol = mongoDb.collection<SessionRecord & { _id: string; token: string }>('sessions');
    const sessionEntries = Object.entries(snapshot.sessions || {});
    const tokens = sessionEntries.map(([t]) => t);
    if (sessionEntries.length > 0) {
      await sessionsCol.bulkWrite(
        sessionEntries.map(([token, rec]) => ({
          replaceOne: {
            filter: { _id: token },
            replacement: { ...rec, token },
            upsert: true,
          },
        }))
      );
      await sessionsCol.deleteMany({ _id: { $nin: tokens } });
    } else {
      await sessionsCol.deleteMany({});
    }

    const metaCol = mongoDb.collection<{
      _id: string;
      progress: StudentProgress;
      bibleSeeded?: boolean;
      updatedAt: string;
    }>('app_meta');
    await metaCol.replaceOne(
      { _id: 'store_meta' },
      {
        progress: snapshot.progress,
        bibleSeeded: snapshot.bibleSeeded,
        updatedAt: new Date().toISOString(),
      },
      { upsert: true }
    );
  } catch (err) {
    console.error('MongoDB sync error:', err instanceof Error ? err.message : err);
  }
}

function queueMongoSync(store: StoreData): void {
  if (!mongoDb) return;
  const snapshot = cloneStore(store);
  mongoSyncChain = mongoSyncChain
    .then(() => syncStoreToMongo(snapshot))
    .catch((err) => {
      console.error('MongoDB sync queue error:', err);
    });
}

let mongoStatus: 'not_configured' | 'connected' | 'invalid_uri' | 'connection_failed' =
  'not_configured';

function normalizeMongoUri(raw: string): string {
  let s = raw.trim();
  if (!s) return '';
  if (/^MONGODB_URI\s*=/i.test(s)) {
    s = s.replace(/^MONGODB_URI\s*=\s*/i, '').trim();
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  const embeddedMatch = s.match(/(mongodb(?:\+srv)?:\/\/[^\s"'`;]+)/i);
  if (embeddedMatch) {
    s = embeddedMatch[1];
  }
  if (
    !/^mongodb(\+srv)?:\/\//i.test(s) &&
    /\.mongodb\.net/i.test(s) &&
    !s.includes(' ')
  ) {
    s = `mongodb+srv://${s.replace(/^\/+/, '')}`;
  }
  return s;
}

async function initMongoStore(): Promise<void> {
  const uri = normalizeMongoUri(process.env.MONGODB_URI || '');
  if (!uri) {
    mongoStatus = 'not_configured';
    return;
  }
  if (!/^mongodb(\+srv)?:\/\//i.test(uri)) {
    mongoStatus = 'invalid_uri';
    console.warn(
      'MONGODB_URI format invalid (must start with mongodb+srv:// or mongodb://). Continuing with local store + Firestore.'
    );
    return;
  }
  const dbName = (process.env.MONGODB_DB_NAME || 'qajeelcha_macaafaa').trim() || 'qajeelcha_macaafaa';

  try {
    mongoClient = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    await mongoClient.connect();
    mongoDb = mongoClient.db(dbName);
    await mongoDb.command({ ping: 1 });
    mongoStatus = 'connected';
    console.log(`MongoDB Atlas connected (database: ${dbName})`);

    const [settingsDoc, docsList, usersList, chatsList, sessionsList, metaDoc] = await Promise.all([
      mongoDb.collection<AdminSettings & { _id: string }>('app_settings').findOne({ _id: 'global' }),
      mongoDb.collection<StudyDocument & { _id: string }>('study_documents').find({}).toArray(),
      mongoDb.collection<UserAccount & { _id: string }>('users').find({}).toArray(),
      mongoDb.collection<ChatThread & { _id: string }>('chat_threads').find({}).toArray(),
      mongoDb.collection<SessionRecord & { _id: string; token: string }>('sessions').find({}).toArray(),
      mongoDb
        .collection<{ _id: string; progress?: StudentProgress; bibleSeeded?: boolean }>('app_meta')
        .findOne({ _id: 'store_meta' }),
    ]);

    if (usersList.length === 0 && docsList.length === 0 && !settingsDoc) {
      const seedStore = loadStore();
      await syncStoreToMongo(seedStore);
      console.log('Seeded initial Qajeelcha Macaafaa data into MongoDB Atlas');
      return;
    }

    const starter = createStarterStore();
    const stripId = <T extends { _id?: unknown }>(doc: T): Omit<T, '_id'> => {
      const { _id: _omit, ...rest } = doc;
      return rest;
    };

    const sessionsMap: Record<string, SessionRecord> = {};
    for (const s of sessionsList) {
      const token = s.token || s._id;
      sessionsMap[token] = { userId: s.userId, createdAt: s.createdAt };
    }

    const hydrated: StoreData = {
      settings: settingsDoc ? stripId(settingsDoc) : starter.settings,
      documents:
        docsList.length > 0
          ? docsList.map(stripId).sort((a, b) => a.order - b.order)
          : starter.documents,
      chats: chatsList.map(stripId),
      progress: metaDoc?.progress ?? { completedDocIds: [], quizScores: {} },
      users: usersList.length > 0 ? usersList.map(stripId) : starter.users,
      sessions: sessionsMap,
      bibleSeeded: metaDoc?.bibleSeeded,
    };

    if (!hydrated.users.some((u) => u.role === 'admin')) {
      hydrated.users.unshift(starter.users[0]);
    }
    for (const c of hydrated.chats) {
      if (!c.userId) c.userId = hydrated.users[0].id;
    }

    if (!hydrated.bibleSeeded && !hydrated.documents.some((d) => d.id.startsWith('doc-bible-'))) {
      const johnDoc = createBibleStudyDocument(
        'JHN',
        'bilingual',
        hydrated.documents.length + 1,
        'Kakuu Haaraa (Oromo & English)'
      );
      if (johnDoc) {
        hydrated.documents.push(johnDoc);
        hydrated.bibleSeeded = true;
      }
    }

    cachedStore = hydrated;
    fs.writeFileSync(STORE_PATH, JSON.stringify(hydrated, null, 2), 'utf8');
  } catch (err) {
    mongoStatus = 'connection_failed';
    console.error(
      'MongoDB Atlas connection failed (continuing with local store + Firestore):',
      err instanceof Error ? err.message : err
    );
    mongoDb = null;
    if (mongoClient) {
      await mongoClient.close().catch(() => {});
      mongoClient = null;
    }
  }
}

function loadStore(): StoreData {
  if (cachedStore) {
    return cachedStore;
  }
  if (!fs.existsSync(STORE_PATH)) {
    const initial = createStarterStore();
    fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2), 'utf8');
    cachedStore = initial;
    return initial;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    const starter = createStarterStore();

    const store: StoreData = {
      settings: parsed.settings ?? starter.settings,
      documents: Array.isArray(parsed.documents) ? parsed.documents : starter.documents,
      chats: Array.isArray(parsed.chats) ? parsed.chats : [],
      progress: parsed.progress ?? { completedDocIds: [], quizScores: {} },
      users: Array.isArray(parsed.users) && parsed.users.length > 0 ? parsed.users : starter.users,
      sessions: parsed.sessions ?? {},
      bibleSeeded: parsed.bibleSeeded,
    };

    // Ensure at least one admin exists if migrating from old store
    if (!store.users.some((u) => u.role === 'admin')) {
      store.users.unshift(starter.users[0]);
    }
    // Ensure chats have userId
    for (const c of store.chats) {
      if (!c.userId) c.userId = store.users[0].id;
    }

    // Seed one starter bilingual Oromo & English Bible book once if local Bible datasets are ready
    if (!store.bibleSeeded && !store.documents.some((d) => d.id.startsWith('doc-bible-'))) {
      const johnDoc = createBibleStudyDocument('JHN', 'bilingual', store.documents.length + 1, 'Kakuu Haaraa (Oromo & English)');
      if (johnDoc) {
        store.documents.push(johnDoc);
        store.bibleSeeded = true;
        saveStore(store);
      }
    }

    cachedStore = store;
    return store;
  } catch {
    const initial = createStarterStore();
    fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2), 'utf8');
    cachedStore = initial;
    return initial;
  }
}

function saveStore(store: StoreData): void {
  cachedStore = store;
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  queueMongoSync(store);
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}_${safeName}`);
    },
  }),
  limits: {
    fileSize: 30 * 1024 * 1024,
  },
});

function getAuthenticatedUser(req: Request, store: StoreData): UserAccount | null {
  const authHeader = req.header('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return null;
  const session = store.sessions[token];
  if (!session) return null;
  return store.users.find((u) => u.id === session.userId) || null;
}

function sanitizeUser(u: UserAccount) {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    createdAt: u.createdAt,
  };
}

function buildSystemPrompt(settings: AdminSettings, docs: StudyDocument[]): string {
  const langGuide =
    settings.languageMode === 'om'
      ? 'Respond primarily in clear, natural Afaan Oromo. Whenever the user asks in English OR asks for both languages ("afaan lamaaniin", "Oromo fi English", "bilingual"), provide the answer and Bible verses clearly in BOTH Afaan Oromo and English!'
      : settings.languageMode === 'en'
        ? 'Respond primarily in clear English, and whenever the user asks in Afaan Oromo or requests both languages ("afaan lamaaniin", "bilingual"), provide BOTH Afaan Oromo and English clearly.'
        : 'Respond bilingually (Afaan Oromo and English) or match the student language seamlessly.';

  const groundingGuide =
    settings.groundingMode === 'strict_files'
      ? `STRICT KNOWLEDGE ACCURACY & NATURAL CONVERSATION (MANDATORY):
- Base ALL factual answers and teachings strictly and accurately on the study materials and bilingual Afaan Oromo & English Bible passages provided below. Do NOT invent outside facts or teachings not present in the materials.
- BILINGUAL BIBLE SHARING (AFAAN OROMO & ENGLISH): Whenever a user asks for a Bible verse, chapter, story, or teaching — or asks for the Bible in both languages ("afaan lamaaniin") — quote the exact verse(s) clearly in BOTH **Afaan Oromo** and **English** from the bilingual Bible passages provided, and converse warmly like a helpful human teacher.
- Have a warm, natural, human-like conversation with the user ("nama waliin haasaa taasisi"). If the user greets you or makes conversational remarks, respond naturally and warmly, then answer what they asked clearly.
- NEVER mention, repeat, or cite file names, document titles, or say "According to the file..." / "Maddi: ..." / "Faayila keessatti...". Speak directly as a knowledgeable human teacher sharing accurate truth.
- Answer ONLY what the user asked clearly and accurately without dumping unrelated chapters.
- If the user asks a factual question whose answer is genuinely NOT in the provided materials or Bible passages, respond warmly and politely with this exact message (or its natural equivalent in the user's language if asked in English): "Odeeffannoon hin jire, ammaaf isiniif deebisuu hin dandeenye; maaloo nagaan Waaqayyoo siif haa baay'atu! Eebbifami!"`
      : `CURRICULUM-FIRST CONVERSATION:
- Ground your answers accurately in the study materials and bilingual Afaan Oromo & English Bible passages provided below, quoting verses in BOTH Afaan Oromo and English whenever helpful or requested.
- Have a warm, natural conversation with the user. NEVER repeat or cite file names ("Maddi: ...", ".md", ".pdf").`;

  return `You are "${settings.tutorName}", a warm, natural, conversational AI Bible Study Companion ("Barsiisaa fi Hiriyyaa Barnoota Macaafa Qulqulluu").
${langGuide}
${groundingGuide}

Additional Guidelines:
${settings.systemInstructions}

Style rules:
- Speak naturally as if having a friendly, respectful one-on-one conversation with the user.
- Give accurate, clear answers directly addressing what the user asked using clean Markdown when helpful.
- NEVER output file names, extensions (.md, .pdf, .txt), or "Maddi:" labels in your replies.`;
}

function buildDocumentParts(
  docs: StudyDocument[],
  settings?: AdminSettings
): Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> {
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

  if (settings?.instructionPdfPath && fs.existsSync(settings.instructionPdfPath)) {
    const pdfBytes = fs.readFileSync(settings.instructionPdfPath);
    parts.push({
      text: `--- ADMIN CHATBOT INSTRUCTION PDF FILE: "${settings.instructionFileName || 'chatbot_instructions.pdf'}" ---`,
    });
    parts.push({
      inlineData: {
        mimeType: 'application/pdf',
        data: pdfBytes.toString('base64'),
      },
    });
  }

  for (const doc of docs) {
    if (doc.mimeType === 'application/pdf' && doc.storedFilePath && fs.existsSync(doc.storedFilePath)) {
      const pdfBytes = fs.readFileSync(doc.storedFilePath);
      parts.push({
        text: `--- ADMIN STUDY PDF FILE: "${doc.title}" (${doc.fileName}, Category: ${doc.category}) ---`,
      });
      parts.push({
        inlineData: {
          mimeType: 'application/pdf',
          data: pdfBytes.toString('base64'),
        },
      });
    } else if (doc.textContent) {
      const truncated = doc.textContent.slice(0, 40000);
      parts.push({
        text: `--- ADMIN STUDY DOCUMENT [${doc.order}]: "${doc.title}" (${doc.fileName}, Category: ${doc.category}) ---\n${truncated}\n--- END OF DOCUMENT ---`,
      });
    }
  }
  return parts;
}

export async function createApp(): Promise<express.Express> {
  await initMongoStore();
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, mongoConnected: Boolean(mongoDb), mongoStatus });
  });

  // Auth: current user
  app.get('/api/auth/me', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Hin seenne (Not authenticated).' });
      return;
    }
    res.json({ user: sanitizeUser(user) });
  });

  // Auth: login (User or Admin)
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const store = loadStore();
    const { username, password, expectedRole } = req.body as {
      username?: string;
      password?: string;
      expectedRole?: 'admin' | 'user';
    };

    if (!username?.trim() || !password) {
      res.status(400).json({ error: 'Maqaa fayyadamaa fi Password galchi.' });
      return;
    }

    const targetName = normalizeUsername(username);
    const user = store.users.find((u) => normalizeUsername(u.username) === targetName);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'Maqaan fayyadamaa ykn Password sirrii miti.' });
      return;
    }

    if (expectedRole === 'admin' && user.role !== 'admin') {
      res.status(403).json({
        error: 'Fayyadamaan kun aangoo Admin hin qabu. Maaloo seenumsa Barataatiin yaali.',
      });
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    store.sessions[token] = {
      userId: user.id,
      createdAt: new Date().toISOString(),
    };
    saveStore(store);

    res.json({ token, user: sanitizeUser(user) });
  });

  // Auth: Google Sign-In via Firebase ID token verification
  app.post('/api/auth/firebase', async (req: Request, res: Response) => {
    const { idToken, expectedRole } = req.body as {
      idToken?: string;
      expectedRole?: 'admin' | 'user';
    };

    if (!idToken || typeof idToken !== 'string' || !idToken.trim()) {
      res.status(400).json({ error: 'Firebase ID token hin argamne.' });
      return;
    }

    const fbConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(fbConfigPath)) {
      res.status(500).json({ error: 'Firebase configuration hin argamne.' });
      return;
    }

    let fbApiKey = '';
    try {
      const cfg = JSON.parse(fs.readFileSync(fbConfigPath, 'utf8')) as { apiKey?: string };
      fbApiKey = cfg.apiKey || '';
    } catch {
      res.status(500).json({ error: 'Firebase configuration dubbisuun hin danda’amne.' });
      return;
    }

    if (!fbApiKey) {
      res.status(500).json({ error: 'Firebase API key hin jiru.' });
      return;
    }

    try {
      const lookupRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(fbApiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: idToken.trim() }),
        }
      );

      if (!lookupRes.ok) {
        res.status(401).json({ error: 'Mirkaneessi Google (Firebase ID token) hin milkoofne.' });
        return;
      }

      const lookupData = (await lookupRes.json()) as {
        users?: Array<{
          localId?: string;
          email?: string;
          emailVerified?: boolean;
          displayName?: string;
        }>;
      };

      const fbAccount = lookupData.users?.[0];
      if (!fbAccount?.localId || !fbAccount.email) {
        res.status(401).json({ error: 'Odeeffannoon Google sirrii miti.' });
        return;
      }

      if (!fbAccount.emailVerified) {
        res.status(403).json({
          error: 'Email Google keessan mirkanaa’uu (verified) qaba.',
        });
        return;
      }

      const store = loadStore();
      const normalizedEmail = fbAccount.email.toLowerCase();
      const isBootstrappedAdmin = normalizedEmail === 'danielbiranu.23@gmail.com';
      const baseUsername = normalizeUsername(fbAccount.email.split('@')[0] || fbAccount.localId);

      let user = store.users.find(
        (u) => u.id === fbAccount.localId || normalizeUsername(u.username) === normalizedEmail
      );

      if (!user) {
        let uniqueUsername = baseUsername || `user_${fbAccount.localId.slice(0, 6)}`;
        if (store.users.some((u) => normalizeUsername(u.username) === uniqueUsername)) {
          uniqueUsername = `${uniqueUsername}_${fbAccount.localId.slice(0, 4)}`;
        }
        user = {
          id: fbAccount.localId,
          username: uniqueUsername,
          fullName: (fbAccount.displayName || baseUsername || 'Fayyadamaa Google').trim(),
          role: isBootstrappedAdmin ? 'admin' : 'user',
          passwordHash: '',
          progress: { completedDocIds: [], quizScores: {} },
          createdAt: new Date().toISOString(),
        };
        store.users.push(user);
      } else {
        if (fbAccount.displayName?.trim()) {
          user.fullName = fbAccount.displayName.trim();
        }
        if (isBootstrappedAdmin && user.role !== 'admin') {
          user.role = 'admin';
        }
      }

      if (expectedRole === 'admin' && user.role !== 'admin') {
        res.status(403).json({
          error:
            'Akkaawuntiin Google kun aangoo Admin hin qabu. Maaloo tab Barataa irratti seeni.',
        });
        return;
      }

      const token = crypto.randomBytes(32).toString('hex');
      store.sessions[token] = {
        userId: user.id,
        createdAt: new Date().toISOString(),
      };
      saveStore(store);

      res.json({ token, user: sanitizeUser(user) });
    } catch {
      res.status(502).json({ error: 'Firebase waliin walqunnamuun hin danda’amne.' });
    }
  });

  // Auth: register new student user
  app.post('/api/auth/register', (req: Request, res: Response) => {
    const store = loadStore();
    const { fullName, username, password } = req.body as {
      fullName?: string;
      username?: string;
      password?: string;
    };

    if (!fullName?.trim() || !username?.trim() || !password) {
      res.status(400).json({ error: 'Maqaa guutuu, Maqaa fayyadamaa, fi Password guutamuu qabu.' });
      return;
    }

    if (username.trim().length < 3) {
      res.status(400).json({ error: 'Maqaan fayyadamaa yoo xiqqaate qubee 3 qabaachuu qaba.' });
      return;
    }

    if (password.length < 4) {
      res.status(400).json({ error: 'Password yoo xiqqaate diijiitii/qubee 4 qabaachuu qaba.' });
      return;
    }

    const normalized = normalizeUsername(username);
    if (store.users.some((u) => normalizeUsername(u.username) === normalized)) {
      res.status(409).json({
        error: 'Maqaan fayyadamaa kun duraan galmaa’eera. Maaloo maqaa biraa filadhu.',
      });
      return;
    }

    const newUser: UserAccount = {
      id: `user-${crypto.randomUUID().slice(0, 8)}`,
      username: username.trim(),
      fullName: fullName.trim(),
      role: 'user',
      passwordHash: hashPassword(password),
      progress: { completedDocIds: [], quizScores: {} },
      createdAt: new Date().toISOString(),
    };

    store.users.push(newUser);
    const token = crypto.randomBytes(32).toString('hex');
    store.sessions[token] = {
      userId: newUser.id,
      createdAt: new Date().toISOString(),
    };
    saveStore(store);

    res.status(201).json({ token, user: sanitizeUser(newUser) });
  });

  // Auth: reset forgotten password using previously registered username
  app.post('/api/auth/reset-password', (req: Request, res: Response) => {
    const store = loadStore();
    const { username, newPassword, expectedRole } = req.body as {
      username?: string;
      newPassword?: string;
      expectedRole?: 'admin' | 'user';
    };

    if (!username?.trim() || !newPassword) {
      res.status(400).json({ error: 'Maqaa dura ittiin galmoofte fi Password haaraa galchi.' });
      return;
    }

    if (newPassword.length < 4) {
      res.status(400).json({ error: 'Password haaraan yoo xiqqaate qubee/lakkoofsa 4 ta’uu qaba.' });
      return;
    }

    const normalized = normalizeUsername(username);
    const user = store.users.find((u) => normalizeUsername(u.username) === normalized);
    if (!user) {
      res.status(404).json({
        error: `Fayyadamaan maqaa "${username.trim()}" jedhuun dura galmaa’e hin argamne.`,
      });
      return;
    }

    if (expectedRole && user.role !== expectedRole) {
      res.status(403).json({
        error:
          expectedRole === 'admin'
            ? 'Maqaan kun Admin miti. Maaloo tab Barataa irratti reset godhi.'
            : 'Maqaan kun kan Admin ti. Maaloo tab Admin irratti reset godhi.',
      });
      return;
    }

    user.passwordHash = hashPassword(newPassword);
    saveStore(store);

    res.json({
      ok: true,
      message: `Password fayyadamaa "${user.username}" milkaa’inaan haaromfameera. Amma seenuu dandeessa.`,
    });
  });

  // Auth: logout
  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const store = loadStore();
    const authHeader = req.header('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (token && store.sessions[token]) {
      delete store.sessions[token];
      saveStore(store);
    }
    res.json({ ok: true });
  });

  // Public/User curriculum & tutor metadata for Student Dashboard
  app.get('/api/curriculum', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }

    const activeDocs = store.documents
      .filter((d) => d.active)
      .sort((a, b) => a.order - b.order);

    res.json({
      settings: {
        tutorName: store.settings.tutorName,
        welcomeGreeting: store.settings.welcomeGreeting,
        systemInstructions: store.settings.systemInstructions,
        instructionFileName: store.settings.instructionFileName,
        languageMode: store.settings.languageMode,
        groundingMode: store.settings.groundingMode,
      },
      documents: activeDocs,
      progress: user.progress,
    });
  });

  // Admin: list all documents, settings, and registered users
  app.get('/api/admin/documents', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Aangoon Admin barbaachisaa dha.' });
      return;
    }
    res.json({
      documents: [...store.documents].sort((a, b) => a.order - b.order),
      settings: {
        tutorName: store.settings.tutorName,
        welcomeGreeting: store.settings.welcomeGreeting,
        systemInstructions: store.settings.systemInstructions,
        instructionFileName: store.settings.instructionFileName,
        languageMode: store.settings.languageMode,
        groundingMode: store.settings.groundingMode,
      },
      users: store.users.map(sanitizeUser),
    });
  });

  // Admin: upload single or multiple study files (.txt, .md, .csv, .json, .pdf, .html)
  app.post('/api/admin/documents/upload', upload.array('files', 10), async (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    const files = (req.files as Express.Multer.File[]) || [];

    if (!user || user.role !== 'admin') {
      for (const f of files) {
        if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
      }
      res.status(403).json({ error: 'Aangoon Admin barbaachisaa dha.' });
      return;
    }

    if (files.length === 0) {
      res.status(400).json({ error: 'Faayilli hin filatamne.' });
      return;
    }

    const allowedExts = ['.txt', '.md', '.csv', '.json', '.pdf', '.html'];
    const baseTitle = ((req.body.title as string) || '').trim();
    const category = ((req.body.category as string) || '').trim() || 'Barnoota Waliigalaa';
    let nextOrder = Number(req.body.order) || store.documents.length + 1;

    const createdDocs: StudyDocument[] = [];
    const rejectedNames: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowedExts.includes(ext)) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        rejectedNames.push(file.originalname);
        continue;
      }

      const title =
        files.length === 1 && baseTitle
          ? baseTitle
          : path.basename(file.originalname, ext).replace(/[_-]+/g, ' ');

      let textContent = '';
      let summary = '';
      const mimeType =
        ext === '.pdf'
          ? 'application/pdf'
          : ext === '.md'
            ? 'text/markdown'
            : 'text/plain';

      if (ext !== '.pdf') {
        textContent = fs.readFileSync(file.path, 'utf8');
        summary = textContent.replace(/[#*_`>-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
        if (summary.length === 180) summary += '...';
      } else {
        summary = `Faayila PDF: ${file.originalname} — Chatbotiin qabiyyee PDF kanaa kallattiin dubbisuu danda’a.`;
      }

      const now = new Date().toISOString();
      const newDoc: StudyDocument = {
        id: `doc-${crypto.randomUUID().slice(0, 8)}`,
        order: nextOrder++,
        title,
        category,
        fileName: file.originalname,
        mimeType,
        sizeBytes: file.size,
        sourceType: 'upload',
        active: true,
        summary: summary || title,
        textContent,
        storedFilePath: file.path,
        createdAt: now,
        updatedAt: now,
      };
      store.documents.push(newDoc);
      createdDocs.push(newDoc);
    }

    if (createdDocs.length === 0) {
      res.status(400).json({
        error: `Gosti faayilaa (${rejectedNames.join(', ')}) hin deeggaramu. Maaloo .pdf, .txt, .md, .csv, ykn .json ol-kaa’i.`,
      });
      return;
    }

    saveStore(store);
    res.status(201).json({
      documents: createdDocs,
      rejected: rejectedNames,
    });
  });

  // Admin: upload a file specifically for Chatbot Instructions / Behavior in Settings
  app.post('/api/admin/settings/instructions-file', upload.single('file'), (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user || user.role !== 'admin') {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(403).json({ error: 'Aangoon Admin barbaachisaa dha.' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Faayilli qajeelfamaa hin filatamne.' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.txt', '.md', '.csv', '.json', '.pdf'];
    if (!allowedExts.includes(ext)) {
      fs.unlinkSync(file.path);
      res.status(400).json({
        error: 'Faayilli qajeelfama Chatbot .pdf, .txt, .md, .csv, ykn .json ta’uu qaba.',
      });
      return;
    }

    if (ext === '.pdf') {
      if (store.settings.instructionPdfPath && fs.existsSync(store.settings.instructionPdfPath)) {
        try {
          fs.unlinkSync(store.settings.instructionPdfPath);
        } catch {
          // ignore
        }
      }
      store.settings.instructionPdfPath = file.path;
      store.settings.instructionFileName = file.originalname;
    } else {
      const content = fs.readFileSync(file.path, 'utf8').trim();
      fs.unlinkSync(file.path);
      store.settings.systemInstructions = content.slice(0, 20000);
      store.settings.instructionFileName = file.originalname;
      store.settings.instructionPdfPath = undefined;
    }

    saveStore(store);
    res.json({
      settings: {
        tutorName: store.settings.tutorName,
        welcomeGreeting: store.settings.welcomeGreeting,
        systemInstructions: store.settings.systemInstructions,
        instructionFileName: store.settings.instructionFileName,
        languageMode: store.settings.languageMode,
        groundingMode: store.settings.groundingMode,
      },
    });
  });

  // Admin: create text lesson directly in Settings
  app.post('/api/admin/documents/text', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Aangoon Admin barbaachisaa dha.' });
      return;
    }

    const { title, category, content, order } = req.body as {
      title?: string;
      category?: string;
      content?: string;
      order?: number;
    };

    if (!title?.trim() || !content?.trim()) {
      res.status(400).json({ error: 'Mata-duree fi qabiyyeen barnootaa guutamuu qabu.' });
      return;
    }

    const cleanText = content.trim();
    const summaryRaw = cleanText.replace(/[#*_`>-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
    const now = new Date().toISOString();

    const newDoc: StudyDocument = {
      id: `doc-${crypto.randomUUID().slice(0, 8)}`,
      order: Number(order) || store.documents.length + 1,
      title: title.trim(),
      category: category?.trim() || 'Barnoota Macaafa Qulqulluu',
      fileName: `${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')}.md`,
      mimeType: 'text/markdown',
      sizeBytes: Buffer.byteLength(cleanText, 'utf8'),
      sourceType: 'lesson',
      active: true,
      summary: summaryRaw.length === 180 ? `${summaryRaw}...` : summaryRaw,
      textContent: cleanText,
      createdAt: now,
      updatedAt: now,
    };

    store.documents.push(newDoc);
    saveStore(store);
    res.status(201).json({ document: newDoc });
  });

  // Admin: update document metadata / active status
  app.patch('/api/admin/documents/:id', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Aangoon Admin barbaachisaa dha.' });
      return;
    }

    const doc = store.documents.find((d) => d.id === req.params.id);
    if (!doc) {
      res.status(404).json({ error: 'Faayilli hin argamne.' });
      return;
    }

    const { active, title, category, order, textContent } = req.body as Partial<StudyDocument>;
    if (typeof active === 'boolean') doc.active = active;
    if (typeof title === 'string' && title.trim()) doc.title = title.trim();
    if (typeof category === 'string' && category.trim()) doc.category = category.trim();
    if (typeof order === 'number' && !Number.isNaN(order)) doc.order = order;
    if (typeof textContent === 'string' && doc.mimeType !== 'application/pdf') {
      doc.textContent = textContent;
      doc.sizeBytes = Buffer.byteLength(textContent, 'utf8');
      const s = textContent.replace(/[#*_`>-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
      doc.summary = s.length === 180 ? `${s}...` : s;
    }
    doc.updatedAt = new Date().toISOString();

    saveStore(store);
    res.json({ document: doc });
  });

  // Admin: delete document
  app.delete('/api/admin/documents/:id', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Aangoon Admin barbaachisaa dha.' });
      return;
    }

    const idx = store.documents.findIndex((d) => d.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Faayilli hin argamne.' });
      return;
    }

    const [removed] = store.documents.splice(idx, 1);
    if (removed.storedFilePath && fs.existsSync(removed.storedFilePath)) {
      try {
        fs.unlinkSync(removed.storedFilePath);
      } catch {
        // Ignore cleanup errors
      }
    }
    saveStore(store);
    res.json({ deleted: true });
  });

  // Admin: update settings
  app.put('/api/admin/settings', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Aangoon Admin barbaachisaa dha.' });
      return;
    }

    const { tutorName, welcomeGreeting, systemInstructions, languageMode, groundingMode } =
      req.body as Partial<AdminSettings>;

    if (typeof tutorName === 'string' && tutorName.trim()) {
      store.settings.tutorName = tutorName.trim();
    }
    if (typeof welcomeGreeting === 'string' && welcomeGreeting.trim()) {
      store.settings.welcomeGreeting = welcomeGreeting.trim();
    }
    if (typeof systemInstructions === 'string') {
      store.settings.systemInstructions = systemInstructions.trim();
    }
    if (languageMode === 'om' || languageMode === 'en' || languageMode === 'bilingual') {
      store.settings.languageMode = languageMode;
    }
    if (groundingMode === 'strict_files' || groundingMode === 'files_plus_bible') {
      store.settings.groundingMode = groundingMode;
    }

    saveStore(store);
    res.json({
      settings: {
        tutorName: store.settings.tutorName,
        welcomeGreeting: store.settings.welcomeGreeting,
        systemInstructions: store.settings.systemInstructions,
        instructionFileName: store.settings.instructionFileName,
        languageMode: store.settings.languageMode,
        groundingMode: store.settings.groundingMode,
      },
    });
  });

  // Admin: update own Admin username & password
  app.put('/api/admin/credentials', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Aangoon Admin barbaachisaa dha.' });
      return;
    }

    const { fullName, username, newPassword } = req.body as {
      fullName?: string;
      username?: string;
      newPassword?: string;
    };

    if (username?.trim()) {
      const normalized = normalizeUsername(username);
      const conflict = store.users.find(
        (u) => u.id !== user.id && normalizeUsername(u.username) === normalized
      );
      if (conflict) {
        res.status(409).json({ error: 'Maqaan kun fayyadamaa biraatiin qabameera.' });
        return;
      }
      user.username = username.trim();
    }

    if (fullName?.trim()) {
      user.fullName = fullName.trim();
    }

    if (newPassword && newPassword.trim().length > 0) {
      if (newPassword.trim().length < 4) {
        res.status(400).json({ error: 'Password haaraan yoo xiqqaate qubee 4 qabaachuu qaba.' });
        return;
      }
      user.passwordHash = hashPassword(newPassword.trim());
    }

    saveStore(store);
    res.json({ user: sanitizeUser(user) });
  });

  // Admin: Free Oromo & English Bible catalog (66 books)
  app.get('/api/admin/bible/catalog', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Aangoon Admin barbaachisaa dha.' });
      return;
    }

    const { om, en } = loadBibleDatasets();
    const enById = new Map((en?.books || []).map((b) => [b.id, b]));
    const omById = new Map((om?.books || []).map((b) => [b.id, b]));
    const importedIds = new Set(
      store.documents
        .filter((d) => d.id.startsWith('doc-bible-'))
        .map((d) => d.id.split('-')[2]?.toUpperCase())
        .filter(Boolean)
    );

    const sourceList = om?.books || en?.books || [];
    const books = sourceList
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((b) => {
        const omBook = omById.get(b.id);
        const enBook = enById.get(b.id);
        return {
          id: b.id,
          order: b.order,
          omName: omBook?.name || b.name,
          omTitle: omBook?.title || omBook?.name || b.name,
          enName: enBook?.name || b.name,
          chapters: omBook?.numberOfChapters || enBook?.numberOfChapters || b.chapters.length,
          verses: omBook?.totalNumberOfVerses || enBook?.totalNumberOfVerses || 0,
          testament: b.order <= 39 ? 'old' : 'new',
          imported: importedIds.has(b.id.toUpperCase()),
        };
      });

    res.json({
      installedOm: Boolean(om),
      installedEn: Boolean(en),
      isFree: true,
      licenseNote:
        'Kitaaba Qulqulluu (Biblica® Open Oromo Contemporary Version) & World English Bible (Public Domain) — 100% Free.',
      books,
    });
  });

  // Admin: Install / refresh free Bible JSON files from open bible API if needed
  app.post('/api/admin/bible/install', async (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Aangoon Admin barbaachisaa dha.' });
      return;
    }

    try {
      if (!fs.existsSync(OROMO_BIBLE_PATH)) {
        const rOm = await fetch('https://bible.helloao.org/api/gaz_bib/complete.json');
        if (!rOm.ok) throw new Error('Macaafa Afaan Oromo buusuun hin danda’amne.');
        fs.writeFileSync(OROMO_BIBLE_PATH, await rOm.text(), 'utf8');
      }
      if (!fs.existsSync(ENGLISH_BIBLE_PATH)) {
        const rEn = await fetch('https://bible.helloao.org/api/ENGWEBP/complete.json');
        if (!rEn.ok) throw new Error('Macaafa English buusuun hin danda’amne.');
        fs.writeFileSync(ENGLISH_BIBLE_PATH, await rEn.text(), 'utf8');
      }
      cachedBibleDatasets = null;
      loadBibleDatasets();
      res.json({ installedOm: true, installedEn: true });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Faayila Macaafa Qulqulluu fe’uun hin milkoofne.',
      });
    }
  });

  // Admin: Import a book from the free Oromo & English Bible directly into study documents
  app.post('/api/admin/bible/import-book', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Aangoon Admin barbaachisaa dha.' });
      return;
    }

    const { bookId, language, category } = req.body as {
      bookId?: string;
      language?: 'bilingual' | 'om' | 'en';
      category?: string;
    };

    if (!bookId?.trim()) {
      res.status(400).json({ error: 'Maaloo kitaaba Macaafa Qulqulluu filadhu.' });
      return;
    }

    const lang: 'bilingual' | 'om' | 'en' =
      language === 'om' || language === 'en' ? language : 'bilingual';

    const created = createBibleStudyDocument(
      bookId.trim(),
      lang,
      store.documents.length + 1,
      category
    );
    if (!created) {
      res.status(404).json({ error: 'Kitaabni filatame hin argamne ykn faayilli Bible hin fe’amne.' });
      return;
    }

    const existingIdx = store.documents.findIndex((d) => d.id === created.id);
    if (existingIdx !== -1) {
      created.order = store.documents[existingIdx].order;
      store.documents[existingIdx] = created;
    } else {
      store.documents.push(created);
    }
    store.bibleSeeded = true;
    saveStore(store);

    res.status(201).json({ document: created });
  });

  // Admin: Download a formatted .md Bible book file (Afaan Oromo, English, or Bilingual)
  app.get('/api/admin/bible/download/:bookId', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Aangoon Admin barbaachisaa dha.' });
      return;
    }

    const rawLang = typeof req.query.lang === 'string' ? req.query.lang : 'bilingual';
    const lang: 'bilingual' | 'om' | 'en' =
      rawLang === 'om' || rawLang === 'en' ? rawLang : 'bilingual';
    const bookId = req.params.bookId.toUpperCase();

    const { om, en } = loadBibleDatasets();
    const omBook = om?.books.find((b) => b.id === bookId);
    const enBook = en?.books.find((b) => b.id === bookId);
    if (!omBook && !enBook) {
      res.status(404).json({ error: 'Kitaabni hin argamne.' });
      return;
    }

    const markdown = formatBibleBookMarkdown(omBook, enBook, lang);
    const filename = `${bookId.toLowerCase()}_${lang}_bible.md`;
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(markdown);
  });

  // Public-to-authenticated (Admin & User): List all 66 Bible books for the Bible Reader
  app.get('/api/bible/books', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }

    const { om, en } = loadBibleDatasets();
    const enById = new Map((en?.books || []).map((b) => [b.id, b]));
    const omById = new Map((om?.books || []).map((b) => [b.id, b]));
    const sourceList = om?.books || en?.books || [];

    const books = sourceList
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((b) => {
        const omBook = omById.get(b.id);
        const enBook = enById.get(b.id);
        return {
          id: b.id,
          order: b.order,
          omName: omBook?.name || b.name,
          omTitle: omBook?.title || omBook?.name || b.name,
          enName: enBook?.name || b.name,
          chapters: omBook?.numberOfChapters || enBook?.numberOfChapters || b.chapters.length,
          verses: omBook?.totalNumberOfVerses || enBook?.totalNumberOfVerses || 0,
          testament: b.order <= 39 ? 'old' : 'new',
          imported: false,
        };
      });

    res.json({
      installedOm: Boolean(om),
      installedEn: Boolean(en),
      books,
    });
  });

  // Public-to-authenticated (Admin & User): Read any Bible chapter in Afaan Oromo & English
  app.get('/api/bible/chapter', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }

    const bookId = (typeof req.query.bookId === 'string' ? req.query.bookId : 'JHN').toUpperCase();
    const chapterNum = Math.max(1, Number(req.query.chapter) || 1);

    const { om, en } = loadBibleDatasets();
    const omBook = om?.books.find((b) => b.id === bookId);
    const enBook = en?.books.find((b) => b.id === bookId);
    if (!omBook && !enBook) {
      res.status(404).json({ error: 'Kitaabni Macaafa Qulqulluu hin argamne.' });
      return;
    }

    const totalChapters = Math.max(
      omBook?.numberOfChapters || omBook?.chapters.length || 1,
      enBook?.numberOfChapters || enBook?.chapters.length || 1
    );
    const safeChapter = Math.min(chapterNum, totalChapters);
    const omCh = omBook?.chapters.find((c) => c.chapter.number === safeChapter);
    const enCh = enBook?.chapters.find((c) => c.chapter.number === safeChapter);

    const omMap = new Map<number, string>();
    for (const item of omCh?.chapter.content || []) {
      if (item.type === 'verse' && typeof item.number === 'number') {
        omMap.set(item.number, extractBibleContentText(item.content));
      }
    }
    const enMap = new Map<number, string>();
    for (const item of enCh?.chapter.content || []) {
      if (item.type === 'verse' && typeof item.number === 'number') {
        enMap.set(item.number, extractBibleContentText(item.content));
      }
    }

    const verseNums = Array.from(new Set([...omMap.keys(), ...enMap.keys()])).sort((a, b) => a - b);
    const verses = verseNums.map((num) => ({
      number: num,
      om: omMap.get(num) || '',
      en: enMap.get(num) || '',
    }));

    res.json({
      bookId,
      omName: omBook?.name || enBook?.name || bookId,
      enName: enBook?.name || omBook?.name || bookId,
      chapter: safeChapter,
      totalChapters,
      verses,
    });
  });

  // Public-to-authenticated (Admin & User): Search across all 66 Bible books in Afaan Oromo & English
  app.get('/api/bible/search', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const testament =
      req.query.testament === 'old' || req.query.testament === 'new' ? req.query.testament : 'all';
    if (!q) {
      res.json({ hits: [] });
      return;
    }

    const { om, en } = loadBibleDatasets();
    if (!om && !en) {
      res.json({ hits: [] });
      return;
    }

    const omById = new Map((om?.books || []).map((b) => [b.id, b]));
    const enById = new Map((en?.books || []).map((b) => [b.id, b]));
    const allBookIds = Array.from(new Set([...omById.keys(), ...enById.keys()])).filter((id) => {
      if (testament === 'all') return true;
      const ord = omById.get(id)?.order || enById.get(id)?.order || 0;
      return testament === 'old' ? ord <= 39 : ord > 39;
    });
    const normQ = normalizeSearchStr(q);

    // Check explicit book + chapter(:verse) first
    let matchedBookId: string | null = null;
    for (const id of allBookIds) {
      const omB = omById.get(id);
      const enB = enById.get(id);
      const candidates = [omB?.name, omB?.commonName, omB?.shortName, enB?.name, enB?.commonName]
        .filter((s): s is string => Boolean(s))
        .map(normalizeSearchStr);
      const aliasEntry = BIBLE_BOOK_ALIASES.find((a) => a.id === id);
      if (aliasEntry) candidates.push(...aliasEntry.terms);
      for (const term of candidates) {
        if (term.length >= 3 && new RegExp(`(^|\\s)${term}(\\s|$)`).test(normQ)) {
          matchedBookId = id;
          break;
        }
      }
      if (matchedBookId) break;
    }

    const hits: Array<{
      bookId: string;
      omName: string;
      enName: string;
      chapter: number;
      verse: number;
      om: string;
      en: string;
    }> = [];

    if (matchedBookId) {
      const omBook = omById.get(matchedBookId);
      const enBook = enById.get(matchedBookId);
      const refMatch = normQ.match(/\b(\d{1,3})(?:\s*:\s*(\d{1,3}))?\b/);
      const chNum = refMatch ? Number(refMatch[1]) : 1;
      const vNum = refMatch?.[2] ? Number(refMatch[2]) : null;
      const omCh = omBook?.chapters.find((c) => c.chapter.number === chNum);
      const enCh = enBook?.chapters.find((c) => c.chapter.number === chNum);
      const omMap = new Map<number, string>();
      for (const item of omCh?.chapter.content || []) {
        if (item.type === 'verse' && typeof item.number === 'number') {
          omMap.set(item.number, extractBibleContentText(item.content));
        }
      }
      const enMap = new Map<number, string>();
      for (const item of enCh?.chapter.content || []) {
        if (item.type === 'verse' && typeof item.number === 'number') {
          enMap.set(item.number, extractBibleContentText(item.content));
        }
      }
      const nums = Array.from(new Set([...omMap.keys(), ...enMap.keys()])).sort((a, b) => a - b);
      const picked = vNum ? nums.filter((n) => n === vNum) : nums.slice(0, 12);
      for (const num of picked) {
        hits.push({
          bookId: matchedBookId,
          omName: omBook?.name || matchedBookId,
          enName: enBook?.name || matchedBookId,
          chapter: chNum,
          verse: num,
          om: omMap.get(num) || '',
          en: enMap.get(num) || '',
        });
      }
    }

    if (hits.length === 0) {
      const terms = normQ.split(/\s+/).filter((w) => w.length >= 3).slice(0, 4);
      if (terms.length > 0) {
        const scored: Array<{ score: number; hit: (typeof hits)[number] }> = [];
        for (const id of allBookIds) {
          const omBook = omById.get(id);
          const enBook = enById.get(id);
          const maxCh = Math.max(omBook?.chapters.length || 0, enBook?.chapters.length || 0);
          for (let ci = 0; ci < maxCh; ci++) {
            const omCh = omBook?.chapters[ci];
            const enCh = enBook?.chapters[ci];
            const chNum = omCh?.chapter.number ?? enCh?.chapter.number ?? ci + 1;
            const omMap = new Map<number, string>();
            for (const item of omCh?.chapter.content || []) {
              if (item.type === 'verse' && typeof item.number === 'number') {
                omMap.set(item.number, extractBibleContentText(item.content));
              }
            }
            const enMap = new Map<number, string>();
            for (const item of enCh?.chapter.content || []) {
              if (item.type === 'verse' && typeof item.number === 'number') {
                enMap.set(item.number, extractBibleContentText(item.content));
              }
            }
            for (const num of omMap.keys()) {
              const omText = omMap.get(num) || '';
              const enText = enMap.get(num) || '';
              const combined = `${omText} ${enText}`.toLowerCase();
              let score = 0;
              for (const t of terms) {
                if (combined.includes(t)) score++;
              }
              if (score > 0) {
                scored.push({
                  score,
                  hit: {
                    bookId: id,
                    omName: omBook?.name || id,
                    enName: enBook?.name || id,
                    chapter: chNum,
                    verse: num,
                    om: omText,
                    en: enText,
                  },
                });
              }
            }
          }
        }
        scored.sort((a, b) => b.score - a.score);
        for (const s of scored.slice(0, 25)) {
          hits.push(s.hit);
        }
      }
    }

    res.json({ hits });
  });

  // Public-to-authenticated (Admin & User): Download any Bible book in Afaan Oromo, English, or Bilingual
  app.get('/api/bible/download/:bookId', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }

    const rawLang = typeof req.query.lang === 'string' ? req.query.lang : 'bilingual';
    const lang: 'bilingual' | 'om' | 'en' =
      rawLang === 'om' || rawLang === 'en' ? rawLang : 'bilingual';
    const bookId = req.params.bookId.toUpperCase();

    const { om, en } = loadBibleDatasets();
    const omBook = om?.books.find((b) => b.id === bookId);
    const enBook = en?.books.find((b) => b.id === bookId);
    if (!omBook && !enBook) {
      res.status(404).json({ error: 'Kitaabni hin argamne.' });
      return;
    }

    const markdown = formatBibleBookMarkdown(omBook, enBook, lang);
    const filename = `${bookId.toLowerCase()}_${lang}_bible.md`;
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(markdown);
  });

  // Public-to-authenticated (Admin & User): Full compact 66-book Bible bundle for browser offline IndexedDB cache
  app.get('/api/offline/bible-bundle', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(getOfflineBibleBundleJson());
  });

  // Public-to-authenticated (Admin & User): Saved & colored Bible verse highlights
  app.get('/api/bible/highlights', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }
    res.json({ highlights: user.highlights || [] });
  });

  app.post('/api/bible/highlights', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }

    const { bookId, omName, enName, chapter, verse, omText, enText, color, note } = req.body as {
      bookId?: string;
      omName?: string;
      enName?: string;
      chapter?: number;
      verse?: number;
      omText?: string;
      enText?: string;
      color?: 'yellow' | 'blue' | 'green' | 'rose';
      note?: string;
    };

    if (!bookId || !chapter || !verse) {
      res.status(400).json({ error: 'Kitaaba, boqonnaa fi lakkoofsi luqqisii barbaachisaa dha.' });
      return;
    }

    const validColor: 'yellow' | 'blue' | 'green' | 'rose' =
      color === 'blue' || color === 'green' || color === 'rose' ? color : 'yellow';
    const upperBookId = bookId.toUpperCase();
    const id = `${upperBookId}:${Number(chapter)}:${Number(verse)}`;

    if (!Array.isArray(user.highlights)) {
      user.highlights = [];
    }

    const entry: BibleHighlight = {
      id,
      bookId: upperBookId,
      omName: (omName || upperBookId).trim(),
      enName: (enName || upperBookId).trim(),
      chapter: Number(chapter),
      verse: Number(verse),
      omText: (omText || '').trim(),
      enText: (enText || '').trim(),
      color: validColor,
      note: typeof note === 'string' && note.trim() ? note.trim() : undefined,
      savedAt: new Date().toISOString(),
    };

    const existingIdx = user.highlights.findIndex((h) => h.id === id);
    if (existingIdx !== -1) {
      user.highlights[existingIdx] = entry;
    } else {
      user.highlights.unshift(entry);
    }

    saveStore(store);
    res.json({ highlights: user.highlights, saved: entry });
  });

  app.delete('/api/bible/highlights/:id', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }
    const targetId = decodeURIComponent(req.params.id);
    user.highlights = (user.highlights || []).filter((h) => h.id !== targetId);
    saveStore(store);
    res.json({ highlights: user.highlights });
  });

  // Serve PDF download/preview for a study document
  app.get('/api/documents/:id/file', (req: Request, res: Response) => {
    const store = loadStore();
    const doc = store.documents.find((d) => d.id === req.params.id);
    if (!doc || !doc.storedFilePath || !fs.existsSync(doc.storedFilePath)) {
      res.status(404).json({ error: 'Faayilli hin argamne.' });
      return;
    }
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${doc.fileName}"`);
    fs.createReadStream(doc.storedFilePath).pipe(res);
  });

  // Chat threads CRUD (scoped to authenticated user)
  app.get('/api/chats', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }
    const sorted = store.chats
      .filter((c) => c.userId === user.id)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    res.json({ chats: sorted });
  });

  app.post('/api/chats', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }
    const { title, focusDocId } = req.body as { title?: string; focusDocId?: string };
    const now = new Date().toISOString();
    const thread: ChatThread = {
      id: `chat-${crypto.randomUUID().slice(0, 8)}`,
      userId: user.id,
      title: title?.trim() || 'Marii Haaraa',
      focusDocId: focusDocId || 'all',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    store.chats.unshift(thread);
    saveStore(store);
    res.status(201).json({ chat: thread });
  });

  app.delete('/api/chats/:id', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }
    const idx = store.chats.findIndex((c) => c.id === req.params.id && c.userId === user.id);
    if (idx !== -1) {
      store.chats.splice(idx, 1);
      saveStore(store);
    }
    res.json({ deleted: true });
  });

  // Per-user Student progress tracking
  app.post('/api/study/progress', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }

    const { docId, completed, quizScore, quizTotal } = req.body as {
      docId?: string;
      completed?: boolean;
      quizScore?: number;
      quizTotal?: number;
    };

    if (!docId) {
      res.status(400).json({ error: 'docId is required' });
      return;
    }

    if (typeof completed === 'boolean') {
      const set = new Set(user.progress.completedDocIds);
      if (completed) set.add(docId);
      else set.delete(docId);
      user.progress.completedDocIds = Array.from(set);
    }

    if (typeof quizScore === 'number' && typeof quizTotal === 'number') {
      user.progress.quizScores[docId] = {
        score: quizScore,
        total: quizTotal,
        completedAt: new Date().toISOString(),
      };
      if (!user.progress.completedDocIds.includes(docId)) {
        user.progress.completedDocIds.push(docId);
      }
    }

    saveStore(store);
    res.json({ progress: user.progress });
  });

  // AI Quiz generation grounded in a specific Admin study document
  app.post('/api/study/quiz', async (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }

    const { docId } = req.body as { docId?: string };
    const doc = store.documents.find((d) => d.id === docId && d.active);
    if (!doc) {
      res.status(404).json({ error: 'Barnootni filatame hin argamne.' });
      return;
    }

    const buildOfflineQuizQuestions = () => {
      const cleanSummary = (doc.summary || doc.textContent || doc.title)
        .replace(/[#*_`>-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140);
      return [
        {
          question: `Mata-dureen barnoota kanaa inni ijoon maali?`,
          options: [
            doc.title,
            'Seenaa biyya lafaa qofa',
            'Barnoota herregaa',
            'Oduu guyyaa',
          ],
          correctIndex: 0,
          explanation: `Barnootni kun "${doc.title}" (${doc.category}) irratti xiyyeeffata.`,
          scriptureRef: doc.category,
        },
        {
          question: `Qabiyyeen gabaabaan barnoota kanaa maal ibsa?`,
          options: [
            cleanSummary || doc.title,
            'Yaada Macaafa Qulqulluun ala ta’e',
            'Seera daldalaa',
            'Sirna teeknoolojii',
          ],
          correctIndex: 0,
          explanation: `Barnoota "${doc.title}" keessatti ergaan kun sirriitti ibsameera.`,
          scriptureRef: doc.title,
        },
        {
          question: `Barnoota Macaafa Qulqulluu kana dubbisuun maal nu gargaara?`,
          options: [
            'Sagalee Waaqayyoo hubachuu fi jireenya amantii keessatti guddachuu',
            'Sagalee Waaqayyoo irraa fagaachuu',
            'Barnoota hafuuraa dagachuu',
            'Deebii tokkollee hin qabu',
          ],
          correctIndex: 0,
          explanation: 'Kaayyoon barnoota kanaa hubannoo sagalee Waaqayyoo cimsuudha.',
          scriptureRef: '2 Ximootewos 3:16',
        },
      ];
    };

    if (!process.env.GEMINI_API_KEY) {
      res.json({ questions: buildOfflineQuizQuestions() });
      return;
    }

    try {
      const docParts = buildDocumentParts([doc], store.settings);
      const langLabel = store.settings.languageMode === 'en' ? 'English' : 'Afaan Oromo';

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          {
            role: 'user',
            parts: [
              ...docParts,
              {
                text: `Based strictly on the study material above ("${doc.title}"), generate exactly 3 thoughtful multiple-choice comprehension questions in ${langLabel} to test a student's understanding of this Bible study lesson. Each question must have 4 options, 1 correctIndex (0-3), a brief explanation referencing the lesson, and a scriptureRef.`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                correctIndex: { type: Type.INTEGER },
                explanation: { type: Type.STRING },
                scriptureRef: { type: Type.STRING },
              },
              required: ['question', 'options', 'correctIndex', 'explanation', 'scriptureRef'],
            },
          },
        },
      });

      const questions = JSON.parse((response.text ?? '[]').trim());
      res.json({ questions: Array.isArray(questions) && questions.length > 0 ? questions : buildOfflineQuizQuestions() });
    } catch (err) {
      console.error('Quiz fallback (using local questions):', err);
      res.json({ questions: buildOfflineQuizQuestions() });
    }
  });

  // ChatGPT-style SSE streaming endpoint grounded in Admin study files
  app.post('/api/chat/stream', async (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }

    const { threadId, message, focusDocId } = req.body as {
      threadId?: string;
      message?: string;
      focusDocId?: string;
    };

    if (!message?.trim()) {
      res.status(400).json({ error: 'Ergaan duwwaa ta’uu hin danda’u.' });
      return;
    }

    const GRACEFUL_UNAVAILABLE_REPLY =
      "Odeeffannoon hin jire, ammaaf isiniif deebisuu hin dandeenye; maaloo nagaan Waaqayyoo siif haa baay'atu! Eebbifami!";

    let thread = store.chats.find((c) => c.id === threadId && c.userId === user.id);
    const now = new Date().toISOString();
    if (!thread) {
      thread = {
        id: `chat-${crypto.randomUUID().slice(0, 8)}`,
        userId: user.id,
        title: message.trim().slice(0, 48),
        focusDocId: focusDocId || 'all',
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      store.chats.unshift(thread);
    } else if (thread.messages.length === 0) {
      thread.title = message.trim().slice(0, 48);
    }

    if (focusDocId) {
      thread.focusDocId = focusDocId;
    }

    const userMsg: ChatMessage = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      role: 'user',
      content: message.trim(),
      createdAt: now,
    };
    thread.messages.push(userMsg);
    thread.updatedAt = now;
    saveStore(store);

    const activeDocs = store.documents
      .filter((d) => d.active)
      .sort((a, b) => a.order - b.order);

    const targetDocs =
      thread.focusDocId && thread.focusDocId !== 'all'
        ? activeDocs.filter((d) => d.id === thread?.focusDocId)
        : activeDocs;

    const systemInstruction = buildSystemPrompt(store.settings, targetDocs);
    const docParts = buildDocumentParts(targetDocs, store.settings);

    const biblePassageContext = searchBibleForQuery(message.trim());
    if (biblePassageContext) {
      docParts.push({ text: biblePassageContext });
    }

    const recentHistory = thread.messages.slice(-12, -1);
    const contents = [
      {
        role: 'user',
        parts: [
          ...docParts,
          {
            text: `The student's name is "${user.fullName}". Use the Admin study materials attached above as the foundation for answering the student in this study session.`,
          },
        ],
      },
      {
        role: 'model',
        parts: [
          {
            text: 'Tole, faayiloota barnootaa Adminiin kenne sirriitti hubadheera. Gaaffii barataatiif qophaa’eera.',
          },
        ],
      },
      ...recentHistory.map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      })),
      {
        role: 'user',
        parts: [{ text: message.trim() }],
      },
    ];

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const sourceNames = targetDocs.map((d) => d.title);
    res.write(`data: ${JSON.stringify({ type: 'meta', threadId: thread.id, sources: sourceNames })}\n\n`);

    if (!process.env.GEMINI_API_KEY) {
      const offlineReply = buildOfflineChatbotReply(
        message.trim(),
        targetDocs,
        biblePassageContext,
        user.fullName
      );
      const fallbackMsg: ChatMessage = {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        role: 'assistant',
        content: offlineReply,
        sources: sourceNames,
        createdAt: new Date().toISOString(),
      };
      thread.messages.push(fallbackMsg);
      thread.updatedAt = new Date().toISOString();
      saveStore(store);

      res.write(`data: ${JSON.stringify({ type: 'chunk', text: offlineReply })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', message: fallbackMsg, thread })}\n\n`);
      res.end();
      return;
    }

    let fullReply = '';
    try {
      const stream = await ai.models.generateContentStream({
        model: 'gemini-4-hydrogen',
        contents,
        config: {
          systemInstruction,
        },
      });

      for await (const chunk of stream) {
        const text = chunk.text ?? '';
        if (text) {
          fullReply += text;
          res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
        }
      }

      const finalContent =
        fullReply ||
        buildOfflineChatbotReply(message.trim(), targetDocs, biblePassageContext, user.fullName);

      if (!fullReply && finalContent) {
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: finalContent })}\n\n`);
      }

      const assistantMsg: ChatMessage = {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        role: 'assistant',
        content: finalContent || GRACEFUL_UNAVAILABLE_REPLY,
        sources: sourceNames,
        createdAt: new Date().toISOString(),
      };
      thread.messages.push(assistantMsg);
      thread.updatedAt = new Date().toISOString();
      saveStore(store);

      res.write(`data: ${JSON.stringify({ type: 'done', message: assistantMsg, thread })}\n\n`);
      res.end();
    } catch (err) {
      console.error('Chat stream fallback (using local grounded engine):', err);
      const fallbackText =
        fullReply ||
        buildOfflineChatbotReply(message.trim(), targetDocs, biblePassageContext, user.fullName);
      const fallbackMsg: ChatMessage = {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        role: 'assistant',
        content: fallbackText,
        sources: sourceNames,
        createdAt: new Date().toISOString(),
      };
      thread.messages.push(fallbackMsg);
      thread.updatedAt = new Date().toISOString();
      saveStore(store);

      if (!fullReply) {
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: fallbackText })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ type: 'done', message: fallbackMsg, thread })}\n\n`);
      res.end();
    }
  });

  // Ensure /api/* always returns JSON (never HTML fallback)
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Tajaajilli API kun hin argamne.' });
  });

  app.use((err: unknown, req: Request, res: Response, next: express.NextFunction) => {
    if (req.path.startsWith('/api')) {
      const msg = err instanceof Error ? err.message : 'Dogoggorri serverii uumameera.';
      res.status(400).json({ error: msg });
      return;
    }
    next(err);
  });

  if (!IS_VERCEL) {
    if (process.env.NODE_ENV !== 'production') {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distDir = path.resolve(process.cwd(), 'dist');
      app.use(express.static(distDir));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  return app;
}

if (!IS_VERCEL) {
  createApp()
    .then((app) => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server listening on http://0.0.0.0:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}
