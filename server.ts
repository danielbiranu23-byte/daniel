import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { MongoClient, type Db } from 'mongodb';
import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import pg from 'pg';

const { Pool: PgPoolClass } = pg;
type PgPool = pg.Pool;

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
  email?: string;
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

interface PersonalNote {
  id: string;
  userId: string;
  ownerRole: 'admin' | 'user';
  title: string;
  content: string;
  category: string;
  scriptureRef?: string;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StoreData {
  settings: AdminSettings;
  documents: StudyDocument[];
  chats: ChatThread[];
  progress: StudentProgress;
  users: UserAccount[];
  notes?: PersonalNote[];
  deletedUserIds?: string[];
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
function resolveProjectFile(...segments: string[]): string {
  const candidates = [
    path.resolve(process.cwd(), ...segments),
    path.resolve(import.meta.dirname || process.cwd(), ...segments),
    path.resolve(import.meta.dirname || process.cwd(), '..', ...segments),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

const BIBLE_DIR = path.resolve(process.cwd(), 'data', 'bible');
const OROMO_BIBLE_PATH = path.join(BIBLE_DIR, 'gaz_bib.json');
const ENGLISH_BIBLE_PATH = path.join(BIBLE_DIR, 'eng_webp.json');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

function ensureDataDirs(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    if (!IS_VERCEL) {
      fs.mkdirSync(BIBLE_DIR, { recursive: true });
    }
  } catch (dirErr) {
    console.warn('Directory initialization warning:', dirErr instanceof Error ? dirErr.message : dirErr);
  }
}

ensureDataDirs();

let cachedBibleDatasets: { om: BibleDataset | null; en: BibleDataset | null } | null = null;

function loadBibleDatasets(): { om: BibleDataset | null; en: BibleDataset | null } {
  if (cachedBibleDatasets) {
    return cachedBibleDatasets;
  }
  let om: BibleDataset | null = null;
  let en: BibleDataset | null = null;
  const omPath = resolveProjectFile('data', 'bible', 'gaz_bib.json');
  const enPath = resolveProjectFile('data', 'bible', 'eng_webp.json');
  try {
    if (fs.existsSync(omPath)) {
      om = JSON.parse(fs.readFileSync(omPath, 'utf8')) as BibleDataset;
    }
  } catch {
    om = null;
  }
  try {
    if (fs.existsSync(enPath)) {
      en = JSON.parse(fs.readFileSync(enPath, 'utf8')) as BibleDataset;
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
  ensureDataDirs();
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

function normalizeEmail(email?: string): string {
  return (email || '').trim().toLowerCase();
}

const ADMIN_PRIMARY_EMAIL = 'danielbiranu.23@gmail.com';

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
    email: ADMIN_PRIMARY_EMAIL,
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
    notes: [],
    sessions: {},
  };
}

let cachedStore: StoreData | null = null;
let mongoClient: MongoClient | null = null;
let mongoDb: Db | null = null;
let mongoSyncChain: Promise<void> = Promise.resolve();
let mysqlPool: Pool | null = null;
let mysqlSyncChain: Promise<void> = Promise.resolve();
let mysqlStatus: 'not_configured' | 'connected' | 'invalid_config' | 'connection_failed' =
  'not_configured';
let supabasePgPool: PgPool | null = null;
let supabaseRestConfig: { url: string; serviceKey: string } | null = null;
let supabaseSyncChain: Promise<void> = Promise.resolve();
let supabaseStatus:
  | 'not_configured'
  | 'connected_postgres'
  | 'connected_rest'
  | 'invalid_config'
  | 'tables_missing'
  | 'rls_blocked'
  | 'connection_failed' = 'not_configured';
let lastSupabaseSyncStatus: 'ok' | 'rls_blocked' | 'error' = 'ok';
let supabaseUsersHasEmailCol: boolean | null = null;
let supabaseHasNotesTable: boolean | null = null;
const syncedSupabaseDocSignatures = new Map<string, string>();

function getDocSyncSignature(d: StudyDocument): string {
  return `${d.updatedAt}|${d.order}|${Boolean(d.active)}|${d.sizeBytes}|${d.title}|${d.category}|${d.storedFilePath ? d.storedFilePath.length : 0}`;
}

function cloneStore(store: StoreData): StoreData {
  return JSON.parse(JSON.stringify(store)) as StoreData;
}

interface ResolvedMysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: { minVersion: 'TLSv1.2'; rejectUnauthorized: boolean };
}

function normalizeMysqlUrl(raw: string): string {
  let s = raw.trim();
  if (!s) return '';
  if (/^(?:MYSQL_URL|MYSQL_URI|DATABASE_URL)\s*=/i.test(s)) {
    s = s.replace(/^(?:MYSQL_URL|MYSQL_URI|DATABASE_URL)\s*=\s*/i, '').trim();
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  const embeddedMatch = s.match(/(mysql2?:\/\/[^\s"'`;]+)/i);
  if (embeddedMatch) {
    s = embeddedMatch[1];
  }
  return s;
}

function resolveMysqlConfig(): {
  status: 'ok' | 'not_configured' | 'invalid_config';
  config?: ResolvedMysqlConfig;
} {
  const rawUrl =
    process.env.MYSQL_URL ||
    process.env.MYSQL_URI ||
    (/^\s*mysql2?:\/\//i.test(process.env.DATABASE_URL || '') ? process.env.DATABASE_URL || '' : '');
  const cleanUrl = normalizeMysqlUrl(rawUrl);

  let host = (process.env.MYSQL_HOST || '').trim();
  let port = Number(process.env.MYSQL_PORT || '3306') || 3306;
  let user = (process.env.MYSQL_USER || '').trim();
  let password = process.env.MYSQL_PASSWORD ?? '';
  let database = (process.env.MYSQL_DATABASE || 'qajeelcha_macaafaa').trim() || 'qajeelcha_macaafaa';

  if (cleanUrl) {
    if (!/^mysql2?:\/\//i.test(cleanUrl)) {
      return { status: 'invalid_config' };
    }
    try {
      const parsed = new URL(cleanUrl);
      host = parsed.hostname || host;
      if (parsed.port) {
        port = Number(parsed.port) || 3306;
      }
      user = parsed.username ? decodeURIComponent(parsed.username) : user;
      password = parsed.password ? decodeURIComponent(parsed.password) : password;
      const pathDb = parsed.pathname.replace(/^\/+/, '').trim();
      if (pathDb) {
        database = decodeURIComponent(pathDb);
      }
    } catch {
      return { status: 'invalid_config' };
    }
  }

  if (!host && !user && !cleanUrl) {
    return { status: 'not_configured' };
  }
  if (!host || !user) {
    return { status: 'invalid_config' };
  }

  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const sslMode = (process.env.MYSQL_SSL || '').trim().toLowerCase();
  const useSsl = sslMode === 'true' || (sslMode !== 'false' && !isLocalHost);

  return {
    status: 'ok',
    config: {
      host,
      port,
      user,
      password,
      database,
      ...(useSsl
        ? {
            ssl: {
              minVersion: 'TLSv1.2',
              rejectUnauthorized: process.env.MYSQL_SSL_REJECT_UNAUTHORIZED === 'true',
            },
          }
        : {}),
    },
  };
}

function parseJsonColumn<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  if (typeof raw === 'object') {
    return raw as T;
  }
  return fallback;
}

async function ensureMysqlSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id VARCHAR(64) PRIMARY KEY,
      tutor_name VARCHAR(255) NOT NULL,
      welcome_greeting TEXT NOT NULL,
      system_instructions LONGTEXT NOT NULL,
      instruction_file_name VARCHAR(255) NULL,
      instruction_pdf_path VARCHAR(512) NULL,
      language_mode VARCHAR(32) NOT NULL,
      grounding_mode VARCHAR(32) NOT NULL,
      updated_at VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS study_documents (
      id VARCHAR(128) PRIMARY KEY,
      sort_order INT NOT NULL,
      title VARCHAR(512) NOT NULL,
      category VARCHAR(255) NOT NULL,
      file_name VARCHAR(512) NOT NULL,
      mime_type VARCHAR(191) NOT NULL,
      size_bytes INT NOT NULL,
      source_type VARCHAR(32) NOT NULL,
      active TINYINT(1) NOT NULL,
      summary MEDIUMTEXT NOT NULL,
      text_content LONGTEXT NOT NULL,
      stored_file_path VARCHAR(512) NULL,
      created_at VARCHAR(64) NOT NULL,
      updated_at VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(128) PRIMARY KEY,
      username VARCHAR(191) NOT NULL UNIQUE,
      full_name VARCHAR(255) NOT NULL,
      role VARCHAR(32) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      progress_json LONGTEXT NOT NULL,
      highlights_json LONGTEXT NULL,
      created_at VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_threads (
      id VARCHAR(128) PRIMARY KEY,
      user_id VARCHAR(128) NOT NULL,
      title VARCHAR(512) NOT NULL,
      focus_doc_id VARCHAR(128) NOT NULL,
      messages_json LONGTEXT NOT NULL,
      created_at VARCHAR(64) NOT NULL,
      updated_at VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(128) PRIMARY KEY,
      user_id VARCHAR(128) NOT NULL,
      created_at VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_meta (
      id VARCHAR(64) PRIMARY KEY,
      progress_json LONGTEXT NOT NULL,
      bible_seeded TINYINT(1) NOT NULL DEFAULT 0,
      updated_at VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function syncStoreToMysql(snapshot: StoreData): Promise<void> {
  if (!mysqlPool) return;
  const conn = await mysqlPool.getConnection();
  try {
    await conn.beginTransaction();
    const now = new Date().toISOString();

    await conn.query(
      `INSERT INTO app_settings
        (id, tutor_name, welcome_greeting, system_instructions, instruction_file_name, instruction_pdf_path, language_mode, grounding_mode, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        tutor_name = VALUES(tutor_name),
        welcome_greeting = VALUES(welcome_greeting),
        system_instructions = VALUES(system_instructions),
        instruction_file_name = VALUES(instruction_file_name),
        instruction_pdf_path = VALUES(instruction_pdf_path),
        language_mode = VALUES(language_mode),
        grounding_mode = VALUES(grounding_mode),
        updated_at = VALUES(updated_at)`,
      [
        'global',
        snapshot.settings.tutorName,
        snapshot.settings.welcomeGreeting,
        snapshot.settings.systemInstructions,
        snapshot.settings.instructionFileName ?? null,
        snapshot.settings.instructionPdfPath ?? null,
        snapshot.settings.languageMode,
        snapshot.settings.groundingMode,
        now,
      ]
    );

    const docIds = snapshot.documents.map((d) => d.id);
    for (const d of snapshot.documents) {
      await conn.query(
        `INSERT INTO study_documents
          (id, sort_order, title, category, file_name, mime_type, size_bytes, source_type, active, summary, text_content, stored_file_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          sort_order = VALUES(sort_order),
          title = VALUES(title),
          category = VALUES(category),
          file_name = VALUES(file_name),
          mime_type = VALUES(mime_type),
          size_bytes = VALUES(size_bytes),
          source_type = VALUES(source_type),
          active = VALUES(active),
          summary = VALUES(summary),
          text_content = VALUES(text_content),
          stored_file_path = VALUES(stored_file_path),
          created_at = VALUES(created_at),
          updated_at = VALUES(updated_at)`,
        [
          d.id,
          d.order,
          d.title,
          d.category,
          d.fileName,
          d.mimeType,
          d.sizeBytes,
          d.sourceType,
          d.active ? 1 : 0,
          d.summary || '',
          d.textContent || '',
          d.storedFilePath ?? null,
          d.createdAt,
          d.updatedAt,
        ]
      );
    }
    if (docIds.length > 0) {
      const ph = docIds.map(() => '?').join(',');
      await conn.query(`DELETE FROM study_documents WHERE id NOT IN (${ph})`, docIds);
    } else {
      await conn.query('DELETE FROM study_documents');
    }

    const userIds = snapshot.users.map((u) => u.id);
    for (const u of snapshot.users) {
      await conn.query(
        `INSERT INTO users
          (id, username, full_name, role, password_hash, progress_json, highlights_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          username = VALUES(username),
          full_name = VALUES(full_name),
          role = VALUES(role),
          password_hash = VALUES(password_hash),
          progress_json = VALUES(progress_json),
          highlights_json = VALUES(highlights_json),
          created_at = VALUES(created_at)`,
        [
          u.id,
          u.username,
          u.fullName,
          u.role,
          u.passwordHash,
          JSON.stringify(u.progress ?? { completedDocIds: [], quizScores: {} }),
          JSON.stringify(u.highlights ?? []),
          u.createdAt,
        ]
      );
    }
    if (userIds.length > 0) {
      const ph = userIds.map(() => '?').join(',');
      await conn.query(`DELETE FROM users WHERE id NOT IN (${ph})`, userIds);
    } else {
      await conn.query('DELETE FROM users');
    }

    const chatIds = snapshot.chats.map((c) => c.id);
    for (const c of snapshot.chats) {
      await conn.query(
        `INSERT INTO chat_threads
          (id, user_id, title, focus_doc_id, messages_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          user_id = VALUES(user_id),
          title = VALUES(title),
          focus_doc_id = VALUES(focus_doc_id),
          messages_json = VALUES(messages_json),
          created_at = VALUES(created_at),
          updated_at = VALUES(updated_at)`,
        [
          c.id,
          c.userId,
          c.title,
          c.focusDocId,
          JSON.stringify(c.messages ?? []),
          c.createdAt,
          c.updatedAt,
        ]
      );
    }
    if (chatIds.length > 0) {
      const ph = chatIds.map(() => '?').join(',');
      await conn.query(`DELETE FROM chat_threads WHERE id NOT IN (${ph})`, chatIds);
    } else {
      await conn.query('DELETE FROM chat_threads');
    }

    const sessionEntries = Object.entries(snapshot.sessions || {});
    const tokens = sessionEntries.map(([t]) => t);
    for (const [token, rec] of sessionEntries) {
      await conn.query(
        `INSERT INTO sessions (token, user_id, created_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
          user_id = VALUES(user_id),
          created_at = VALUES(created_at)`,
        [token, rec.userId, rec.createdAt]
      );
    }
    if (tokens.length > 0) {
      const ph = tokens.map(() => '?').join(',');
      await conn.query(`DELETE FROM sessions WHERE token NOT IN (${ph})`, tokens);
    } else {
      await conn.query('DELETE FROM sessions');
    }

    await conn.query(
      `INSERT INTO app_meta (id, progress_json, bible_seeded, updated_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        progress_json = VALUES(progress_json),
        bible_seeded = VALUES(bible_seeded),
        updated_at = VALUES(updated_at)`,
      [
        'store_meta',
        JSON.stringify(snapshot.progress ?? { completedDocIds: [], quizScores: {} }),
        snapshot.bibleSeeded ? 1 : 0,
        now,
      ]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('MySQL sync error:', err instanceof Error ? err.message : err);
  } finally {
    conn.release();
  }
}

async function initMysqlStore(): Promise<void> {
  const resolved = resolveMysqlConfig();
  if (resolved.status === 'not_configured') {
    mysqlStatus = 'not_configured';
    return;
  }
  if (resolved.status === 'invalid_config' || !resolved.config) {
    mysqlStatus = 'invalid_config';
    console.warn('MySQL configuration invalid (check MYSQL_URL or MYSQL_HOST/MYSQL_USER).');
    return;
  }

  try {
    const cfg = resolved.config;
    mysqlPool = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 5000,
      ...(cfg.ssl ? { ssl: cfg.ssl } : {}),
    });

    await mysqlPool.query('SELECT 1');
    await ensureMysqlSchema(mysqlPool);
    mysqlStatus = 'connected';
    console.log(`MySQL connected (database: ${cfg.database})`);

    const [
      [settingsRows],
      [docsRows],
      [usersRows],
      [chatsRows],
      [sessionsRows],
      [metaRows],
    ] = await Promise.all([
      mysqlPool.query<RowDataPacket[]>('SELECT * FROM app_settings WHERE id = ?', ['global']),
      mysqlPool.query<RowDataPacket[]>('SELECT * FROM study_documents ORDER BY sort_order ASC'),
      mysqlPool.query<RowDataPacket[]>('SELECT * FROM users'),
      mysqlPool.query<RowDataPacket[]>('SELECT * FROM chat_threads'),
      mysqlPool.query<RowDataPacket[]>('SELECT * FROM sessions'),
      mysqlPool.query<RowDataPacket[]>('SELECT * FROM app_meta WHERE id = ?', ['store_meta']),
    ]);

    if (usersRows.length === 0 && docsRows.length === 0 && settingsRows.length === 0) {
      const seedStore = loadStore();
      await syncStoreToMysql(seedStore);
      console.log('Seeded initial Qajeelcha Macaafaa data into MySQL');
      return;
    }

    const starter = createStarterStore();
    const sRow = settingsRows[0];
    const settings: AdminSettings = sRow
      ? {
          tutorName: String(sRow.tutor_name || starter.settings.tutorName),
          welcomeGreeting: String(sRow.welcome_greeting || starter.settings.welcomeGreeting),
          systemInstructions: String(sRow.system_instructions || starter.settings.systemInstructions),
          instructionFileName: sRow.instruction_file_name ? String(sRow.instruction_file_name) : undefined,
          instructionPdfPath: sRow.instruction_pdf_path ? String(sRow.instruction_pdf_path) : undefined,
          languageMode: (sRow.language_mode as AdminSettings['languageMode']) || starter.settings.languageMode,
          groundingMode: (sRow.grounding_mode as AdminSettings['groundingMode']) || starter.settings.groundingMode,
        }
      : starter.settings;

    const documents: StudyDocument[] =
      docsRows.length > 0
        ? docsRows.map((row) => ({
            id: String(row.id),
            order: Number(row.sort_order) || 1,
            title: String(row.title || ''),
            category: String(row.category || ''),
            fileName: String(row.file_name || ''),
            mimeType: String(row.mime_type || 'text/plain'),
            sizeBytes: Number(row.size_bytes) || 0,
            sourceType: (row.source_type as StudyDocument['sourceType']) || 'starter',
            active: Boolean(row.active),
            summary: String(row.summary || ''),
            textContent: String(row.text_content || ''),
            storedFilePath: row.stored_file_path ? String(row.stored_file_path) : undefined,
            createdAt: String(row.created_at || new Date().toISOString()),
            updatedAt: String(row.updated_at || new Date().toISOString()),
          }))
        : starter.documents;

    const users: UserAccount[] =
      usersRows.length > 0
        ? usersRows.map((row) => ({
            id: String(row.id),
            username: String(row.username),
            fullName: String(row.full_name || row.username),
            role: row.role === 'admin' ? 'admin' : 'user',
            passwordHash: String(row.password_hash),
            progress: parseJsonColumn<StudentProgress>(row.progress_json, {
              completedDocIds: [],
              quizScores: {},
            }),
            highlights: parseJsonColumn<BibleHighlight[]>(row.highlights_json, []),
            createdAt: String(row.created_at || new Date().toISOString()),
          }))
        : starter.users;

    const chats: ChatThread[] = chatsRows.map((row) => ({
      id: String(row.id),
      userId: String(row.user_id),
      title: String(row.title || 'Haasaa'),
      focusDocId: String(row.focus_doc_id || 'all'),
      messages: parseJsonColumn<ChatMessage[]>(row.messages_json, []),
      createdAt: String(row.created_at || new Date().toISOString()),
      updatedAt: String(row.updated_at || new Date().toISOString()),
    }));

    const sessionsMap: Record<string, SessionRecord> = {};
    for (const row of sessionsRows) {
      sessionsMap[String(row.token)] = {
        userId: String(row.user_id),
        createdAt: String(row.created_at || new Date().toISOString()),
      };
    }

    const mRow = metaRows[0];
    const hydrated: StoreData = {
      settings,
      documents,
      chats,
      progress: parseJsonColumn<StudentProgress>(mRow?.progress_json, {
        completedDocIds: [],
        quizScores: {},
      }),
      users,
      sessions: sessionsMap,
      bibleSeeded: mRow ? Boolean(mRow.bible_seeded) : undefined,
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
    ensureDataDirs();
    fs.writeFileSync(STORE_PATH, JSON.stringify(hydrated, null, 2), 'utf8');
  } catch (err) {
    mysqlStatus = 'connection_failed';
    console.error(
      'MySQL connection failed (continuing with fallback store):',
      err instanceof Error ? err.message : err
    );
    if (mysqlPool) {
      await mysqlPool.end().catch(() => {});
      mysqlPool = null;
    }
  }
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

function normalizePostgresUrl(raw: string): string {
  let s = raw.trim();
  if (!s) return '';
  if (/^(?:SUPABASE_DB_URL|POSTGRES_URL|POSTGRES_PRISMA_URL|POSTGRES_URL_NON_POOLING|DATABASE_URL)\s*=/i.test(s)) {
    s = s.replace(/^(?:SUPABASE_DB_URL|POSTGRES_URL|POSTGRES_PRISMA_URL|POSTGRES_URL_NON_POOLING|DATABASE_URL)\s*=\s*/i, '').trim();
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  const embeddedMatch = s.match(/(postgres(?:ql)?:\/\/[^\s"'`;]+)/i);
  if (embeddedMatch) {
    s = embeddedMatch[1];
  }
  return s;
}

async function ensureSupabasePgSchema(pool: PgPool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY,
      tutor_name TEXT NOT NULL,
      welcome_greeting TEXT NOT NULL,
      system_instructions TEXT NOT NULL,
      instruction_file_name TEXT NULL,
      instruction_pdf_path TEXT NULL,
      language_mode TEXT NOT NULL,
      grounding_mode TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS study_documents (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      summary TEXT NOT NULL,
      text_content TEXT NOT NULL,
      stored_file_path TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      progress_json TEXT NOT NULL,
      highlights_json TEXT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT NULL`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_threads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      focus_doc_id TEXT NOT NULL,
      messages_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_meta (
      id TEXT PRIMARY KEY,
      progress_json TEXT NOT NULL,
      bible_seeded BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      owner_role TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Yaadannoo',
      scripture_ref TEXT NULL,
      pinned BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_user_notes_user_role ON user_notes (user_id, owner_role, updated_at DESC)`
  );
}

function hydrateStoreFromSqlRows(
  settingsRows: Array<Record<string, unknown>>,
  docsRows: Array<Record<string, unknown>>,
  usersRows: Array<Record<string, unknown>>,
  chatsRows: Array<Record<string, unknown>>,
  sessionsRows: Array<Record<string, unknown>>,
  metaRows: Array<Record<string, unknown>>,
  notesRows: Array<Record<string, unknown>> = []
): StoreData {
  const starter = createStarterStore();
  const sRow = settingsRows[0];
  const settings: AdminSettings = sRow
    ? {
        tutorName: String(sRow.tutor_name || starter.settings.tutorName),
        welcomeGreeting: String(sRow.welcome_greeting || starter.settings.welcomeGreeting),
        systemInstructions: String(sRow.system_instructions || starter.settings.systemInstructions),
        instructionFileName: sRow.instruction_file_name ? String(sRow.instruction_file_name) : undefined,
        instructionPdfPath: sRow.instruction_pdf_path ? String(sRow.instruction_pdf_path) : undefined,
        languageMode: (sRow.language_mode as AdminSettings['languageMode']) || starter.settings.languageMode,
        groundingMode: (sRow.grounding_mode as AdminSettings['groundingMode']) || starter.settings.groundingMode,
      }
    : starter.settings;

  const documents: StudyDocument[] =
    docsRows.length > 0
      ? docsRows.map((row) => ({
          id: String(row.id),
          order: Number(row.sort_order) || 1,
          title: String(row.title || ''),
          category: String(row.category || ''),
          fileName: String(row.file_name || ''),
          mimeType: String(row.mime_type || 'text/plain'),
          sizeBytes: Number(row.size_bytes) || 0,
          sourceType: (row.source_type as StudyDocument['sourceType']) || 'starter',
          active: Boolean(row.active),
          summary: String(row.summary || ''),
          textContent: String(row.text_content || ''),
          storedFilePath: row.stored_file_path ? String(row.stored_file_path) : undefined,
          createdAt: String(row.created_at || new Date().toISOString()),
          updatedAt: String(row.updated_at || new Date().toISOString()),
        }))
      : starter.documents;

  const users: UserAccount[] =
    usersRows.length > 0
      ? usersRows.map((row) => ({
          id: String(row.id),
          username: String(row.username),
          email: row.email ? normalizeEmail(String(row.email)) : undefined,
          fullName: String(row.full_name || row.username),
          role: row.role === 'admin' ? 'admin' : 'user',
          passwordHash: String(row.password_hash),
          progress: parseJsonColumn<StudentProgress>(row.progress_json, {
            completedDocIds: [],
            quizScores: {},
          }),
          highlights: parseJsonColumn<BibleHighlight[]>(row.highlights_json, []),
          createdAt: String(row.created_at || new Date().toISOString()),
        }))
      : starter.users;

  // Ensure primary admin always retains primary email for direct email+password sign-in
  const primaryAdmin = users.find((u) => u.id === 'user-admin-default') || users.find((u) => u.role === 'admin');
  if (primaryAdmin && !primaryAdmin.email) {
    primaryAdmin.email = ADMIN_PRIMARY_EMAIL;
  }

  const chats: ChatThread[] = chatsRows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title || 'Haasaa'),
    focusDocId: String(row.focus_doc_id || 'all'),
    messages: parseJsonColumn<ChatMessage[]>(row.messages_json, []),
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
  }));

  const sessionsMap: Record<string, SessionRecord> = {};
  for (const row of sessionsRows) {
    sessionsMap[String(row.token)] = {
      userId: String(row.user_id),
      createdAt: String(row.created_at || new Date().toISOString()),
    };
  }

  const notes: PersonalNote[] = notesRows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    ownerRole: row.owner_role === 'admin' ? 'admin' : 'user',
    title: String(row.title || 'Yaadannoo'),
    content: String(row.content || ''),
    category: String(row.category || 'Yaadannoo'),
    scriptureRef: row.scripture_ref ? String(row.scripture_ref) : undefined,
    pinned: Boolean(row.pinned),
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
  }));

  const mRow = metaRows[0];
  const hydrated: StoreData = {
    settings,
    documents,
    chats,
    progress: parseJsonColumn<StudentProgress>(mRow?.progress_json, {
      completedDocIds: [],
      quizScores: {},
    }),
    users,
    notes,
    sessions: sessionsMap,
    bibleSeeded: mRow ? Boolean(mRow.bible_seeded) : undefined,
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

  return hydrated;
}

function preserveLocalFieldsBeforeSqlMigration(
  hydrated: StoreData,
  preserveNotes: boolean
): void {
  try {
    if (!fs.existsSync(STORE_PATH)) return;
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    if (!raw.trim()) return;
    const localStore = JSON.parse(raw) as Partial<StoreData>;

    if (Array.isArray(localStore.users)) {
      const localById = new Map<string, UserAccount>();
      const localByUsername = new Map<string, UserAccount>();
      for (const lu of localStore.users) {
        if (lu?.id) localById.set(lu.id, lu);
        if (lu?.username) localByUsername.set(normalizeUsername(lu.username), lu);
      }
      for (const u of hydrated.users) {
        if (!u.email) {
          const matched = localById.get(u.id) || localByUsername.get(normalizeUsername(u.username));
          if (matched?.email) {
            u.email = normalizeEmail(matched.email);
          }
        }
      }
    }

    if (
      preserveNotes &&
      Array.isArray(localStore.notes) &&
      localStore.notes.length > 0 &&
      (!hydrated.notes || hydrated.notes.length === 0)
    ) {
      hydrated.notes = localStore.notes;
    }
  } catch {
    // Ignore unreadable local cache during pre-migration preservation
  }
}

async function syncStoreToSupabasePg(snapshot: StoreData): Promise<void> {
  if (!supabasePgPool) return;
  const client = await supabasePgPool.connect();
  try {
    await client.query('BEGIN');
    const now = new Date().toISOString();

    await client.query(
      `INSERT INTO app_settings
        (id, tutor_name, welcome_greeting, system_instructions, instruction_file_name, instruction_pdf_path, language_mode, grounding_mode, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
        tutor_name = EXCLUDED.tutor_name,
        welcome_greeting = EXCLUDED.welcome_greeting,
        system_instructions = EXCLUDED.system_instructions,
        instruction_file_name = EXCLUDED.instruction_file_name,
        instruction_pdf_path = EXCLUDED.instruction_pdf_path,
        language_mode = EXCLUDED.language_mode,
        grounding_mode = EXCLUDED.grounding_mode,
        updated_at = EXCLUDED.updated_at`,
      [
        'global',
        snapshot.settings.tutorName,
        snapshot.settings.welcomeGreeting,
        snapshot.settings.systemInstructions,
        snapshot.settings.instructionFileName ?? null,
        snapshot.settings.instructionPdfPath ?? null,
        snapshot.settings.languageMode,
        snapshot.settings.groundingMode,
        now,
      ]
    );

    const docIds = snapshot.documents.map((d) => d.id);
    for (const d of snapshot.documents) {
      await client.query(
        `INSERT INTO study_documents
          (id, sort_order, title, category, file_name, mime_type, size_bytes, source_type, active, summary, text_content, stored_file_path, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO UPDATE SET
          sort_order = EXCLUDED.sort_order,
          title = EXCLUDED.title,
          category = EXCLUDED.category,
          file_name = EXCLUDED.file_name,
          mime_type = EXCLUDED.mime_type,
          size_bytes = EXCLUDED.size_bytes,
          source_type = EXCLUDED.source_type,
          active = EXCLUDED.active,
          summary = EXCLUDED.summary,
          text_content = EXCLUDED.text_content,
          stored_file_path = EXCLUDED.stored_file_path,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at`,
        [
          d.id,
          d.order,
          d.title,
          d.category,
          d.fileName,
          d.mimeType,
          d.sizeBytes,
          d.sourceType,
          Boolean(d.active),
          d.summary || '',
          d.textContent || '',
          d.storedFilePath ?? null,
          d.createdAt,
          d.updatedAt,
        ]
      );
    }
    if (docIds.length > 0) {
      await client.query('DELETE FROM study_documents WHERE NOT (id = ANY($1::text[]))', [docIds]);
    } else {
      await client.query('DELETE FROM study_documents');
    }

    const userIds = snapshot.users.map((u) => u.id);
    for (const u of snapshot.users) {
      await client.query(
        `INSERT INTO users
          (id, username, email, full_name, role, password_hash, progress_json, highlights_json, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
          username = EXCLUDED.username,
          email = EXCLUDED.email,
          full_name = EXCLUDED.full_name,
          role = EXCLUDED.role,
          password_hash = EXCLUDED.password_hash,
          progress_json = EXCLUDED.progress_json,
          highlights_json = EXCLUDED.highlights_json,
          created_at = EXCLUDED.created_at`,
        [
          u.id,
          u.username,
          u.email ?? null,
          u.fullName,
          u.role,
          u.passwordHash,
          JSON.stringify(u.progress ?? { completedDocIds: [], quizScores: {} }),
          JSON.stringify(u.highlights ?? []),
          u.createdAt,
        ]
      );
    }
    if (userIds.length > 0) {
      await client.query('DELETE FROM users WHERE NOT (id = ANY($1::text[]))', [userIds]);
    } else {
      await client.query('DELETE FROM users');
    }

    const chatIds = snapshot.chats.map((c) => c.id);
    for (const c of snapshot.chats) {
      await client.query(
        `INSERT INTO chat_threads
          (id, user_id, title, focus_doc_id, messages_json, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          title = EXCLUDED.title,
          focus_doc_id = EXCLUDED.focus_doc_id,
          messages_json = EXCLUDED.messages_json,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at`,
        [
          c.id,
          c.userId,
          c.title,
          c.focusDocId,
          JSON.stringify(c.messages ?? []),
          c.createdAt,
          c.updatedAt,
        ]
      );
    }
    if (chatIds.length > 0) {
      await client.query('DELETE FROM chat_threads WHERE NOT (id = ANY($1::text[]))', [chatIds]);
    } else {
      await client.query('DELETE FROM chat_threads');
    }

    const sessionEntries = Object.entries(snapshot.sessions || {});
    const tokens = sessionEntries.map(([t]) => t);
    for (const [token, rec] of sessionEntries) {
      await client.query(
        `INSERT INTO sessions (token, user_id, created_at)
         VALUES ($1,$2,$3)
         ON CONFLICT (token) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          created_at = EXCLUDED.created_at`,
        [token, rec.userId, rec.createdAt]
      );
    }
    if (tokens.length > 0) {
      await client.query('DELETE FROM sessions WHERE NOT (token = ANY($1::text[]))', [tokens]);
    } else {
      await client.query('DELETE FROM sessions');
    }

    await client.query(
      `INSERT INTO app_meta (id, progress_json, bible_seeded, updated_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET
        progress_json = EXCLUDED.progress_json,
        bible_seeded = EXCLUDED.bible_seeded,
        updated_at = EXCLUDED.updated_at`,
      [
        'store_meta',
        JSON.stringify(snapshot.progress ?? { completedDocIds: [], quizScores: {} }),
        Boolean(snapshot.bibleSeeded),
        now,
      ]
    );

    const notesList = snapshot.notes ?? [];
    const noteIds = notesList.map((n) => n.id);
    for (const n of notesList) {
      await client.query(
        `INSERT INTO user_notes
          (id, user_id, owner_role, title, content, category, scripture_ref, pinned, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          owner_role = EXCLUDED.owner_role,
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          category = EXCLUDED.category,
          scripture_ref = EXCLUDED.scripture_ref,
          pinned = EXCLUDED.pinned,
          updated_at = EXCLUDED.updated_at`,
        [
          n.id,
          n.userId,
          n.ownerRole,
          n.title,
          n.content,
          n.category,
          n.scriptureRef ?? null,
          Boolean(n.pinned),
          n.createdAt,
          n.updatedAt,
        ]
      );
    }
    if (noteIds.length > 0) {
      await client.query('DELETE FROM user_notes WHERE NOT (id = ANY($1::text[]))', [noteIds]);
    } else {
      await client.query('DELETE FROM user_notes');
    }

    await client.query('COMMIT');
    lastSupabaseSyncStatus = 'ok';
  } catch (err) {
    lastSupabaseSyncStatus = 'error';
    await client.query('ROLLBACK').catch(() => {});
    console.error('Supabase PostgreSQL sync error:', err instanceof Error ? err.message : err);
  } finally {
    client.release();
  }
}

async function supabaseRestFetch(
  cfg: { url: string; serviceKey: string },
  pathAndQuery: string,
  init?: RequestInit
): Promise<globalThis.Response> {
  const baseUrl = cfg.url.replace(/\/+$/, '');
  return fetch(`${baseUrl}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: cfg.serviceKey,
      Authorization: `Bearer ${cfg.serviceKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
}

async function syncStoreToSupabaseRest(
  snapshot: StoreData
): Promise<'ok' | 'rls_blocked' | 'error'> {
  if (!supabaseRestConfig) return 'error';
  const cfg = supabaseRestConfig;
  const now = new Date().toISOString();
  let rlsBlocked = false;
  let hadError = false;
  try {
    const assertRestOk = async (label: string, resp: globalThis.Response): Promise<void> => {
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        if (resp.status === 401 || resp.status === 403 || /42501|row-level security/i.test(body)) {
          rlsBlocked = true;
        } else {
          hadError = true;
        }
        console.error(`Supabase REST ${label} error (${resp.status}):`, body);
      }
    };

    const tasks: Array<Promise<void>> = [
      supabaseRestFetch(cfg, 'app_settings?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify([
          {
            id: 'global',
            tutor_name: snapshot.settings.tutorName,
            welcome_greeting: snapshot.settings.welcomeGreeting,
            system_instructions: snapshot.settings.systemInstructions,
            instruction_file_name: snapshot.settings.instructionFileName ?? null,
            instruction_pdf_path: snapshot.settings.instructionPdfPath ?? null,
            language_mode: snapshot.settings.languageMode,
            grounding_mode: snapshot.settings.groundingMode,
            updated_at: now,
          },
        ]),
      }).then((r) => assertRestOk('app_settings', r)),

      supabaseRestFetch(cfg, 'app_meta?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify([
          {
            id: 'store_meta',
            progress_json: JSON.stringify(snapshot.progress ?? { completedDocIds: [], quizScores: {} }),
            bible_seeded: Boolean(snapshot.bibleSeeded),
            updated_at: now,
          },
        ]),
      }).then((r) => assertRestOk('app_meta', r)),
    ];

    if (snapshot.users.length > 0) {
      if (supabaseUsersHasEmailCol === null || supabaseUsersHasEmailCol === false) {
        const probe = await supabaseRestFetch(cfg, 'users?select=email&limit=1').catch(() => null);
        supabaseUsersHasEmailCol = Boolean(probe?.ok);
      }
      tasks.push(
        supabaseRestFetch(cfg, 'users?on_conflict=id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(
            snapshot.users.map((u) => ({
              id: u.id,
              username: u.username,
              ...(supabaseUsersHasEmailCol ? { email: u.email ?? null } : {}),
              full_name: u.fullName,
              role: u.role,
              password_hash: u.passwordHash,
              progress_json: JSON.stringify(u.progress ?? { completedDocIds: [], quizScores: {} }),
              highlights_json: JSON.stringify(u.highlights ?? []),
              created_at: u.createdAt,
            }))
          ),
        }).then((r) => assertRestOk('users', r))
      );
    }

    const sessionEntries = Object.entries(snapshot.sessions || {});
    if (sessionEntries.length > 0) {
      tasks.push(
        supabaseRestFetch(cfg, 'sessions?on_conflict=token', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(
            sessionEntries.map(([token, rec]) => ({
              token,
              user_id: rec.userId,
              created_at: rec.createdAt,
            }))
          ),
        }).then((r) => assertRestOk('sessions', r))
      );
    }

    const docsToUpsert = snapshot.documents.filter(
      (d) => syncedSupabaseDocSignatures.get(d.id) !== getDocSyncSignature(d)
    );

    if (docsToUpsert.length > 0) {
      tasks.push(
        (async () => {
          const concurrency = 3;
          for (let i = 0; i < docsToUpsert.length; i += concurrency) {
            const batch = docsToUpsert.slice(i, i + concurrency);
            await Promise.all(
              batch.map(async (d) => {
                const resp = await supabaseRestFetch(cfg, 'study_documents?on_conflict=id', {
                  method: 'POST',
                  headers: { Prefer: 'resolution=merge-duplicates' },
                  body: JSON.stringify([
                    {
                      id: d.id,
                      sort_order: d.order,
                      title: d.title,
                      category: d.category,
                      file_name: d.fileName,
                      mime_type: d.mimeType,
                      size_bytes: d.sizeBytes,
                      source_type: d.sourceType,
                      active: Boolean(d.active),
                      summary: d.summary || '',
                      text_content: d.textContent || '',
                      stored_file_path: d.storedFilePath ?? null,
                      created_at: d.createdAt,
                      updated_at: d.updatedAt,
                    },
                  ]),
                });
                if (resp.ok) {
                  syncedSupabaseDocSignatures.set(d.id, getDocSyncSignature(d));
                } else {
                  await assertRestOk(`study_documents(${d.id})`, resp);
                }
              })
            );
          }
        })()
      );
    }

    if (snapshot.chats.length > 0) {
      tasks.push(
        supabaseRestFetch(cfg, 'chat_threads?on_conflict=id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(
            snapshot.chats.map((c) => ({
              id: c.id,
              user_id: c.userId,
              title: c.title,
              focus_doc_id: c.focusDocId,
              messages_json: JSON.stringify(c.messages ?? []),
              created_at: c.createdAt,
              updated_at: c.updatedAt,
            }))
          ),
        }).then((r) => assertRestOk('chat_threads', r))
      );
    }

    const notesList = snapshot.notes ?? [];
    if (supabaseHasNotesTable === null || supabaseHasNotesTable === false) {
      const probeNotes = await supabaseRestFetch(cfg, 'user_notes?select=id&limit=1').catch(() => null);
      supabaseHasNotesTable = Boolean(probeNotes?.ok);
    }
    if (supabaseHasNotesTable && notesList.length > 0) {
      tasks.push(
        supabaseRestFetch(cfg, 'user_notes?on_conflict=id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(
            notesList.map((n) => ({
              id: n.id,
              user_id: n.userId,
              owner_role: n.ownerRole,
              title: n.title,
              content: n.content,
              category: n.category,
              scripture_ref: n.scriptureRef ?? null,
              pinned: Boolean(n.pinned),
              created_at: n.createdAt,
              updated_at: n.updatedAt,
            }))
          ),
        }).then((r) => assertRestOk('user_notes', r))
      );
    }

    await Promise.all(tasks);
    if (rlsBlocked) {
      lastSupabaseSyncStatus = 'rls_blocked';
      return 'rls_blocked';
    }

    await Promise.all([
      (async () => {
        const existingDocsResp = await supabaseRestFetch(cfg, 'study_documents?select=id');
        if (existingDocsResp.ok) {
          const existingDocs = (await existingDocsResp.json()) as Array<{ id: string }>;
          const keepDocIds = new Set(snapshot.documents.map((d) => d.id));
          await Promise.all(
            existingDocs
              .filter((row) => !keepDocIds.has(row.id))
              .map(async (row) => {
                const delResp = await supabaseRestFetch(
                  cfg,
                  `study_documents?id=eq.${encodeURIComponent(row.id)}`,
                  { method: 'DELETE' }
                );
                if (delResp.ok) {
                  syncedSupabaseDocSignatures.delete(row.id);
                }
              })
          );
        }
      })(),
      (async () => {
        const existingChatsResp = await supabaseRestFetch(cfg, 'chat_threads?select=id');
        if (existingChatsResp.ok) {
          const existingChats = (await existingChatsResp.json()) as Array<{ id: string }>;
          const keepChatIds = new Set(snapshot.chats.map((c) => c.id));
          await Promise.all(
            existingChats
              .filter((row) => !keepChatIds.has(row.id))
              .map((row) =>
                supabaseRestFetch(cfg, `chat_threads?id=eq.${encodeURIComponent(row.id)}`, {
                  method: 'DELETE',
                })
              )
          );
        }
      })(),
      (async () => {
        const existingSessionsResp = await supabaseRestFetch(cfg, 'sessions?select=token');
        if (existingSessionsResp.ok) {
          const existingSessions = (await existingSessionsResp.json()) as Array<{ token: string }>;
          const keepTokens = new Set(Object.keys(snapshot.sessions || {}));
          await Promise.all(
            existingSessions
              .filter((row) => !keepTokens.has(row.token))
              .map((row) =>
                supabaseRestFetch(cfg, `sessions?token=eq.${encodeURIComponent(row.token)}`, {
                  method: 'DELETE',
                })
              )
          );
        }
      })(),
      (async () => {
        const existingUsersResp = await supabaseRestFetch(cfg, 'users?select=id');
        if (existingUsersResp.ok) {
          const existingUsers = (await existingUsersResp.json()) as Array<{ id: string }>;
          const keepUserIds = new Set(snapshot.users.map((u) => u.id));
          await Promise.all(
            existingUsers
              .filter((row) => !keepUserIds.has(row.id))
              .map((row) =>
                supabaseRestFetch(cfg, `users?id=eq.${encodeURIComponent(row.id)}`, {
                  method: 'DELETE',
                })
              )
          );
        }
      })(),
      (async () => {
        if (!supabaseHasNotesTable) return;
        const existingNotesResp = await supabaseRestFetch(cfg, 'user_notes?select=id');
        if (existingNotesResp.ok) {
          const existingNotes = (await existingNotesResp.json()) as Array<{ id: string }>;
          const keepNoteIds = new Set(notesList.map((n) => n.id));
          await Promise.all(
            existingNotes
              .filter((row) => !keepNoteIds.has(row.id))
              .map((row) =>
                supabaseRestFetch(cfg, `user_notes?id=eq.${encodeURIComponent(row.id)}`, {
                  method: 'DELETE',
                })
              )
          );
        }
      })(),
    ]);

    lastSupabaseSyncStatus = rlsBlocked ? 'rls_blocked' : hadError ? 'error' : 'ok';
    return lastSupabaseSyncStatus;
  } catch (err) {
    console.error('Supabase REST sync error:', err instanceof Error ? err.message : err);
    lastSupabaseSyncStatus = 'error';
    return 'error';
  }
}

function loadSupabaseFileConfig(): { url?: string; publishableKey?: string } {
  try {
    const cfgPath = resolveProjectFile('supabase-config.json');
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as {
        url?: string;
        publishableKey?: string;
      };
    }
  } catch {
    // Ignore malformed optional config file
  }
  return {};
}

async function initSupabaseStore(): Promise<void> {
  const rawPgUrl =
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_PRISMA_URL ||
    (/^\s*postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL || '') ? process.env.DATABASE_URL || '' : '');
  const pgUrl = normalizePostgresUrl(rawPgUrl);

  const fileCfg = loadSupabaseFileConfig();
  const restUrl = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    fileCfg.url ||
    ''
  ).trim();
  const serviceKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    fileCfg.publishableKey ||
    ''
  ).trim();

  if (pgUrl) {
    if (!/^postgres(?:ql)?:\/\//i.test(pgUrl) || /\[YOUR-PASSWORD\]/i.test(pgUrl)) {
      supabaseStatus = 'invalid_config';
      console.warn('Supabase Postgres URL invalid (replace [YOUR-PASSWORD] and ensure postgres:// format).');
      return;
    }
    try {
      const isLocal = /localhost|127\.0\.0\.1|::1/i.test(pgUrl);
      supabasePgPool = new PgPoolClass({
        connectionString: pgUrl,
        max: 5,
        connectionTimeoutMillis: 6000,
        ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
      });
      await supabasePgPool.query('SELECT 1');
      await ensureSupabasePgSchema(supabasePgPool);
      supabaseStatus = 'connected_postgres';
      console.log('Supabase PostgreSQL connected');

      const [settingsRes, docsRes, usersRes, chatsRes, sessionsRes, metaRes, notesRes] = await Promise.all([
        supabasePgPool.query('SELECT * FROM app_settings WHERE id = $1', ['global']),
        supabasePgPool.query('SELECT * FROM study_documents ORDER BY sort_order ASC'),
        supabasePgPool.query('SELECT * FROM users'),
        supabasePgPool.query('SELECT * FROM chat_threads'),
        supabasePgPool.query('SELECT * FROM sessions'),
        supabasePgPool.query('SELECT * FROM app_meta WHERE id = $1', ['store_meta']),
        supabasePgPool.query('SELECT * FROM user_notes ORDER BY pinned DESC, updated_at DESC'),
      ]);

      if (usersRes.rows.length === 0 && docsRes.rows.length === 0 && settingsRes.rows.length === 0) {
        const seedStore = loadStore();
        await syncStoreToSupabasePg(seedStore);
        console.log('Seeded initial Qajeelcha Macaafaa data into Supabase PostgreSQL');
        return;
      }

      const hydrated = hydrateStoreFromSqlRows(
        settingsRes.rows,
        docsRes.rows,
        usersRes.rows,
        chatsRes.rows,
        sessionsRes.rows,
        metaRes.rows,
        notesRes.rows
      );
      preserveLocalFieldsBeforeSqlMigration(hydrated, false);
      cachedStore = hydrated;
      ensureDataDirs();
      fs.writeFileSync(STORE_PATH, JSON.stringify(hydrated, null, 2), 'utf8');
      return;
    } catch (err) {
      supabaseStatus = 'connection_failed';
      console.error(
        'Supabase PostgreSQL connection failed:',
        err instanceof Error ? err.message : err
      );
      if (supabasePgPool) {
        await supabasePgPool.end().catch(() => {});
        supabasePgPool = null;
      }
    }
  }

  if (restUrl && serviceKey) {
    if (!/^https?:\/\//i.test(restUrl)) {
      supabaseStatus = 'invalid_config';
      return;
    }
    const cfg = { url: restUrl, serviceKey };
    try {
      const [settingsResp, docsResp, usersResp, chatsResp, sessionsResp, metaResp, notesResp] = await Promise.all([
        supabaseRestFetch(cfg, 'app_settings?id=eq.global'),
        supabaseRestFetch(cfg, 'study_documents?order=sort_order.asc'),
        supabaseRestFetch(cfg, 'users'),
        supabaseRestFetch(cfg, 'chat_threads'),
        supabaseRestFetch(cfg, 'sessions'),
        supabaseRestFetch(cfg, 'app_meta?id=eq.store_meta'),
        supabaseRestFetch(cfg, 'user_notes?order=pinned.desc,updated_at.desc'),
      ]);

      if (settingsResp.status === 404 || usersResp.status === 404) {
        supabaseStatus = 'tables_missing';
        console.warn('Supabase REST connected, but tables have not been created yet.');
        return;
      }
      if (!settingsResp.ok || !usersResp.ok) {
        const errBody = await settingsResp.text().catch(() => '');
        if (/PGRST205|does not exist|Could not find the table/i.test(errBody)) {
          supabaseStatus = 'tables_missing';
          return;
        }
        supabaseStatus = 'connection_failed';
        return;
      }

      supabaseHasNotesTable = Boolean(notesResp.ok);
      const [settingsRows, docsRows, usersRows, chatsRows, sessionsRows, metaRows, notesRows] =
        await Promise.all([
          settingsResp.json() as Promise<Array<Record<string, unknown>>>,
          docsResp.ok ? (docsResp.json() as Promise<Array<Record<string, unknown>>>) : Promise.resolve([]),
          usersResp.json() as Promise<Array<Record<string, unknown>>>,
          chatsResp.ok ? (chatsResp.json() as Promise<Array<Record<string, unknown>>>) : Promise.resolve([]),
          sessionsResp.ok ? (sessionsResp.json() as Promise<Array<Record<string, unknown>>>) : Promise.resolve([]),
          metaResp.ok ? (metaResp.json() as Promise<Array<Record<string, unknown>>>) : Promise.resolve([]),
          notesResp.ok ? (notesResp.json() as Promise<Array<Record<string, unknown>>>) : Promise.resolve([]),
        ]);

      supabaseRestConfig = cfg;
      if (usersRows.length === 0 && docsRows.length === 0 && settingsRows.length === 0) {
        const seedStore = loadStore();
        const seedResult = await syncStoreToSupabaseRest(seedStore);
        if (seedResult === 'rls_blocked') {
          supabaseStatus = 'rls_blocked';
          supabaseRestConfig = null;
          console.warn(
            'Supabase REST blocked by Row-Level Security (use SUPABASE_SERVICE_ROLE_KEY or disable RLS / add policy).'
          );
          return;
        }
        if (seedResult === 'error') {
          supabaseStatus = 'connection_failed';
          supabaseRestConfig = null;
          return;
        }
        supabaseStatus = 'connected_rest';
        console.log('Seeded initial Qajeelcha Macaafaa data into Supabase REST');
        return;
      }
      supabaseStatus = 'connected_rest';
      console.log('Supabase REST API connected');

      const hydrated = hydrateStoreFromSqlRows(
        settingsRows,
        docsRows,
        usersRows,
        chatsRows,
        sessionsRows,
        metaRows,
        notesRows
      );
      preserveLocalFieldsBeforeSqlMigration(hydrated, !supabaseHasNotesTable);
      syncedSupabaseDocSignatures.clear();
      const fetchedDocIds = new Set(docsRows.map((row) => String(row.id)));
      for (const doc of hydrated.documents) {
        if (fetchedDocIds.has(doc.id)) {
          syncedSupabaseDocSignatures.set(doc.id, getDocSyncSignature(doc));
        }
      }
      cachedStore = hydrated;
      ensureDataDirs();
      fs.writeFileSync(STORE_PATH, JSON.stringify(hydrated, null, 2), 'utf8');
      return;
    } catch (err) {
      supabaseStatus = 'connection_failed';
      console.error('Supabase REST connection failed:', err instanceof Error ? err.message : err);
      supabaseRestConfig = null;
    }
  } else if (restUrl || serviceKey) {
    supabaseStatus = 'invalid_config';
  } else {
    supabaseStatus = 'not_configured';
  }
}

function queueExternalDbSync(store: StoreData): void {
  if (!mongoDb && !mysqlPool && !supabasePgPool && !supabaseRestConfig) return;
  const snapshot = cloneStore(store);
  if (supabasePgPool) {
    supabaseSyncChain = supabaseSyncChain
      .then(() => syncStoreToSupabasePg(snapshot))
      .catch((err) => {
        console.error('Supabase PostgreSQL sync queue error:', err);
      });
  } else if (supabaseRestConfig) {
    supabaseSyncChain = supabaseSyncChain
      .then(async () => {
        await syncStoreToSupabaseRest(snapshot);
      })
      .catch((err) => {
        console.error('Supabase REST sync queue error:', err);
      });
  }
  if (mysqlPool) {
    mysqlSyncChain = mysqlSyncChain
      .then(() => syncStoreToMysql(snapshot))
      .catch((err) => {
        console.error('MySQL sync queue error:', err);
      });
  }
  if (mongoDb) {
    mongoSyncChain = mongoSyncChain
      .then(() => syncStoreToMongo(snapshot))
      .catch((err) => {
        console.error('MongoDB sync queue error:', err);
      });
  }
}

export async function flushDbSync(timeoutMs = 3000): Promise<void> {
  if (!mongoDb && !mysqlPool && !supabasePgPool && !supabaseRestConfig) return;
  await Promise.race([
    Promise.all([supabaseSyncChain, mysqlSyncChain, mongoSyncChain]),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export const flushMongoSync = flushDbSync;

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
    mongoClient = new MongoClient(uri, { serverSelectionTimeoutMS: 4000 });
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
    ensureDataDirs();
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
  ensureDataDirs();
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
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      deletedUserIds: Array.isArray(parsed.deletedUserIds) ? parsed.deletedUserIds : [],
      sessions: parsed.sessions ?? {},
      bibleSeeded: parsed.bibleSeeded,
    };

    // Ensure at least one admin exists if migrating from old store
    if (!store.users.some((u) => u.role === 'admin')) {
      store.users.unshift(starter.users[0]);
    }
    const adminWithMissingEmail =
      store.users.find((u) => u.id === 'user-admin-default') ||
      store.users.find((u) => u.role === 'admin');
    if (adminWithMissingEmail && !adminWithMissingEmail.email) {
      adminWithMissingEmail.email = ADMIN_PRIMARY_EMAIL;
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
    ensureDataDirs();
    fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2), 'utf8');
    cachedStore = initial;
    return initial;
  }
}

function saveStore(store: StoreData): void {
  cachedStore = store;
  ensureDataDirs();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  queueExternalDbSync(store);
}

let cachedAiClient: GoogleGenAI | null | undefined;

function getAiClient(): GoogleGenAI | null {
  if (cachedAiClient !== undefined) {
    return cachedAiClient;
  }
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    cachedAiClient = null;
    return null;
  }
  try {
    cachedAiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  } catch (err) {
    console.error('GoogleGenAI init warning (using offline engine):', err);
    cachedAiClient = null;
  }
  return cachedAiClient;
}

const PDF_DATA_URI_PREFIX = 'data:application/pdf;base64,';
const MAX_INLINE_PDF_BYTES = 15 * 1024 * 1024;

function readStoredPdfBuffer(storedPath?: string): Buffer | null {
  if (!storedPath || storedPath === 'database') return null;
  if (/^data:[^;]+;base64,/i.test(storedPath)) {
    const commaIdx = storedPath.indexOf(',');
    if (commaIdx === -1) return null;
    try {
      const buf = Buffer.from(storedPath.slice(commaIdx + 1), 'base64');
      return buf.length > 0 ? buf : null;
    } catch {
      return null;
    }
  }
  if (fs.existsSync(storedPath)) {
    try {
      return fs.readFileSync(storedPath);
    } catch {
      return null;
    }
  }
  const fallbackUploadPath = path.join(UPLOADS_DIR, path.basename(storedPath));
  if (fs.existsSync(fallbackUploadPath)) {
    try {
      return fs.readFileSync(fallbackUploadPath);
    } catch {
      return null;
    }
  }
  return null;
}

function readUploadedTextFile(filePath: string): string {
  const raw = fs.readFileSync(filePath);
  let decoded: string;
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    decoded = raw.subarray(2).toString('utf16le');
  } else if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    const swapped = Buffer.from(raw.subarray(2));
    swapped.swap16();
    decoded = swapped.toString('utf16le');
  } else {
    decoded = raw.toString('utf8');
  }
  return decoded.replace(/^\uFEFF/, '').replace(/\u0000/g, '');
}

function sanitizeDocumentForClient(doc: StudyDocument): StudyDocument {
  if (!doc.storedFilePath) return doc;
  return {
    ...doc,
    storedFilePath: doc.storedFilePath.startsWith('data:') ? 'database' : doc.storedFilePath,
  };
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDataDirs();
      cb(null, UPLOADS_DIR);
    },
    filename: (_req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}_${safeName}`);
    },
  }),
  limits: {
    fileSize: 30 * 1024 * 1024,
  },
});

let cachedAuthSecret: string | null = null;

function getAuthTokenSecret(): string {
  if (cachedAuthSecret) return cachedAuthSecret;
  if (process.env.AUTH_SECRET?.trim()) {
    cachedAuthSecret = process.env.AUTH_SECRET.trim();
    return cachedAuthSecret;
  }
  let seed = 'qajeelcha-macaafaa-default-signing-seed';
  try {
    const fbPath = resolveProjectFile('firebase-applet-config.json');
    if (fs.existsSync(fbPath)) {
      const cfg = JSON.parse(fs.readFileSync(fbPath, 'utf8')) as {
        projectId?: string;
        apiKey?: string;
      };
      seed = `${cfg.projectId || ''}:${cfg.apiKey || ''}:qajeelcha-macaafaa-v1`;
    }
  } catch {
    // Keep fallback seed
  }
  cachedAuthSecret = crypto.createHash('sha256').update(seed).digest('hex');
  return cachedAuthSecret;
}

interface SignedTokenPayload {
  uid: string;
  username: string;
  fullName: string;
  role: 'admin' | 'user';
  exp: number;
}

function issueAuthToken(user: UserAccount): string {
  const payload: SignedTokenPayload = {
    uid: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getAuthTokenSecret())
    .update(encoded)
    .digest('base64url');
  return `qm1.${encoded}.${sig}`;
}

function verifyStatelessAuthToken(token: string): SignedTokenPayload | null {
  if (!token.startsWith('qm1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, encoded, sig] = parts;
  if (!encoded || !sig) return null;
  const expectedSig = crypto
    .createHmac('sha256', getAuthTokenSecret())
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedTokenPayload;
    if (!parsed?.uid || typeof parsed.exp !== 'number' || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function getAuthenticatedUser(req: Request, store: StoreData): UserAccount | null {
  const authHeader = req.header('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return null;
  const session = store.sessions[token];
  if (session) {
    const found = store.users.find((u) => u.id === session.userId);
    if (found) return found;
  }
  const signed = verifyStatelessAuthToken(token);
  if (!signed) return null;
  if (store.deletedUserIds?.includes(signed.uid)) {
    return null;
  }
  let user = store.users.find((u) => u.id === signed.uid) || null;
  if (!user) {
    user = {
      id: signed.uid,
      username: signed.username || 'fayyadamaa',
      fullName: signed.fullName || 'Fayyadamaa',
      role: signed.role === 'admin' ? 'admin' : 'user',
      passwordHash: '',
      progress: { completedDocIds: [], quizScores: {} },
      createdAt: new Date().toISOString(),
    };
    store.users.push(user);
  }
  return user;
}

function sanitizeUser(u: UserAccount) {
  return {
    id: u.id,
    username: u.username,
    email: u.email || '',
    fullName: u.fullName,
    role: u.role,
    createdAt: u.createdAt,
  };
}

function buildSystemPrompt(settings: AdminSettings, _docs: StudyDocument[]): string {
  const langGuide =
    settings.languageMode === 'om'
      ? 'Respond primarily in clear, natural, warm Afaan Oromo. Whenever the user asks in English OR requests both languages ("afaan lamaaniin", "Oromo fi English", "bilingual"), provide the teaching and Scripture clearly in BOTH Afaan Oromo and English.'
      : settings.languageMode === 'en'
        ? 'Respond primarily in clear English, and whenever the user asks in Afaan Oromo or requests both languages ("afaan lamaaniin", "bilingual"), provide BOTH Afaan Oromo and English clearly.'
        : 'Respond bilingually (Afaan Oromo and English) or seamlessly match the student’s preferred language.';

  const groundingGuide =
    settings.groundingMode === 'strict_files'
      ? `FAITHFUL SCRIPTURE & WISDOM COUNSEL (MANDATORY):
- Ground EVERY teaching, doctrine, and life counsel accurately in the 66-book Bilingual Holy Bible (Kitaaba Qulqulluu 1999 & World English Bible) and the study materials attached in this session.
- WISE SPIRITUAL & LIFE COUNSEL ("Gorsa Sirrii"): When a user shares struggles or asks for advice (anxiety, fear, sadness, grief, forgiveness, marriage/family, parenting, decisions, prayer, temptation, work, anger, sickness, or faith doubts), respond like a compassionate, wise Christian pastor & Bible teacher:
  1. Acknowledge their feelings warmly and respectfully in their language.
  2. Give clear, practical, biblically faithful counsel steps (**Gorsa Qabatamaa**).
  3. Anchor the counsel in 2–4 exact Bible verses from the passages provided (and faithful Christian Scripture), citing book, chapter, and verse cleanly so links become clickable (e.g., **Filiphisiyus 4:6-7**, **Fakkeenya 3:5-6**, **Isaayaas 41:10**, **Yohaannis 3:16**, **Roomaa 8:28**), quoting BOTH **Afaan Oromo** and **English** when helpful.
  4. End with a brief encouraging blessing or prayerful thought.
- Do NOT fabricate verse wording when quoting verbatim — quote faithfully from the bilingual passages provided and accurate biblical text.
- NEVER mention, repeat, or cite internal file names, extensions (.md, .pdf, .txt), or say "According to the file..." / "Maddi: ..." / "Faayila keessatti...". Speak directly as a wise human Bible teacher and counselor.
- Reserve "Odeeffannoon hin jire..." ONLY for completely off-topic non-biblical trivia unrelated to Christianity, the Bible, life counsel, or the study curriculum.`
      : `CURRICULUM & PASTORAL BIBLE COUNSEL:
- Teach faithfully from the 66-book Bilingual Holy Bible (Afaan Oromo & English) and the attached study materials, offering both accurate Scriptural exegesis and compassionate, practical Christian counsel ("gorsa sirrii").
- Cite exact book, chapter, and verse references cleanly (e.g., **Yohaannis 14:6**, **Roomaa 8:28**) and quote verses in Afaan Oromo and English whenever helpful or requested.
- Speak naturally and compassionately, and NEVER repeat internal file names or ".md"/".pdf" extensions.`;

  return `You are "${settings.tutorName}", a deeply knowledgeable, wise, and compassionate Bible Teacher and Spiritual Counselor ("Barsiisaa Macaafa Qulqulluu fi Gorsaa Afuuraa Dhugaa").
${langGuide}
${groundingGuide}

Additional Ministry Guidelines:
${settings.systemInstructions}

Formatting & Tone Rules:
- Be warm, pastoral, clear, and truthful — never robotic, cold, or dismissive.
- Use clean Markdown headings, numbered practical counsel steps, and blockquotes or bulleted Scripture quotes when teaching or counseling.
- Always format Scripture citations cleanly (Book Chapter:Verse, e.g., Yohaannis 3:16, Faarfannaa 23:1-4, Matthew 11:28) so the student can click to open them directly in the Bible Reader.
- NEVER invent medical diagnoses; for urgent physical or mental health crises, warmly encourage seeking trusted medical care and local pastoral support alongside prayer.
- NEVER output file names, extensions (.md, .pdf, .txt), or "Maddi:" labels.`;
}

function buildDocumentParts(
  docs: StudyDocument[],
  settings?: AdminSettings,
  query?: string
): Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> {
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

  const instructionPdfBytes = readStoredPdfBuffer(settings?.instructionPdfPath);
  if (instructionPdfBytes) {
    parts.push({
      text: `--- ADMIN CHATBOT INSTRUCTION PDF FILE: "${settings?.instructionFileName || 'chatbot_instructions.pdf'}" ---`,
    });
    parts.push({
      inlineData: {
        mimeType: 'application/pdf',
        data: instructionPdfBytes.toString('base64'),
      },
    });
  }

  const queryKeywords = query
    ? normalizeSearchStr(query)
        .split(/\s+/)
        .filter((w) => w.length >= 3)
    : [];

  const rankedDocs = [...docs].sort((a, b) => {
    if (queryKeywords.length === 0) return a.order - b.order;
    const scoreDoc = (d: StudyDocument) => {
      const hay = `${d.title} ${d.category} ${d.summary} ${d.textContent.slice(0, 6000)}`.toLowerCase();
      return queryKeywords.reduce((acc, kw) => acc + (hay.includes(kw) ? 1 : 0), 0);
    };
    return scoreDoc(b) - scoreDoc(a);
  });

  const selectedDocs = rankedDocs.length > 6 ? rankedDocs.slice(0, 6) : rankedDocs;
  const maxCharsPerDoc = selectedDocs.length <= 2 ? 32000 : 14000;

  for (const doc of selectedDocs) {
    if (doc.mimeType === 'application/pdf') {
      const pdfBytes = readStoredPdfBuffer(doc.storedFilePath);
      if (pdfBytes) {
        parts.push({
          text: `--- ADMIN STUDY PDF FILE: "${doc.title}" (${doc.fileName}, Category: ${doc.category}) ---`,
        });
        parts.push({
          inlineData: {
            mimeType: 'application/pdf',
            data: pdfBytes.toString('base64'),
          },
        });
      }
    } else if (doc.textContent) {
      const truncated = doc.textContent.slice(0, maxCharsPerDoc);
      parts.push({
        text: `--- ADMIN STUDY DOCUMENT [${doc.order}]: "${doc.title}" (Category: ${doc.category}) ---\n${truncated}\n--- END OF DOCUMENT ---`,
      });
    }
  }
  return parts;
}

export async function createApp(httpServer?: http.Server): Promise<express.Express> {
  await initSupabaseStore();
  if (!supabasePgPool && !supabaseRestConfig) {
    await initMysqlStore();
  }
  if (!supabasePgPool && !supabaseRestConfig && !mysqlPool) {
    await initMongoStore();
  }
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    const dbEngine =
      supabasePgPool || supabaseRestConfig
        ? 'supabase'
        : mysqlPool
          ? 'mysql'
          : mongoDb
            ? 'mongodb'
            : 'local_firestore';
    res.json({
      ok: true,
      dbEngine,
      supabaseConnected: Boolean(supabasePgPool || supabaseRestConfig),
      supabaseStatus,
      mysqlConnected: Boolean(mysqlPool),
      mysqlStatus,
      mongoConnected: Boolean(mongoDb),
      mongoStatus,
    });
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

  // Auth: login (User or Admin, via Email OR Username + Password)
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const store = loadStore();
    const { username, password, expectedRole } = req.body as {
      username?: string;
      password?: string;
      expectedRole?: 'admin' | 'user';
    };

    if (!username?.trim() || !password) {
      res.status(400).json({ error: 'Email ykn Maqaa fayyadamaa fi Password galchi.' });
      return;
    }

    const targetInput = normalizeUsername(username);
    const user = store.users.find(
      (u) =>
        normalizeUsername(u.username) === targetInput ||
        (u.email && normalizeEmail(u.email) === targetInput)
    );

    if (!user) {
      if (expectedRole !== 'admin' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetInput)) {
        res.status(404).json({
          error: 'Email kun duraan hin galmoofne. Maqaa Guutuu kee galchuun Kutaa Barataa seeni.',
          needsRegistration: true,
        });
        return;
      }
      res.status(401).json({ error: 'Email/Maqaan fayyadamaa ykn Password sirrii miti.' });
      return;
    }

    if (!user.passwordHash) {
      res.status(401).json({
        error:
          'Akkaawuntiin kun Google dhaan baname; password hin qabu. "Password dagadheera?" tuqiitii email keetiin password haaraa kenni.',
      });
      return;
    }

    if (!verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'Email/Maqaan fayyadamaa ykn Password sirrii miti.' });
      return;
    }

    if (expectedRole === 'admin' && user.role !== 'admin') {
      res.status(403).json({
        error: 'Fayyadamaan kun aangoo Admin hin qabu. Maaloo seenumsa Barataatiin yaali.',
      });
      return;
    }

    const token = issueAuthToken(user);
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

    const fbConfigPath = resolveProjectFile('firebase-applet-config.json');
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
      const normalizedEmail = normalizeEmail(fbAccount.email);
      const isBootstrappedAdmin = normalizedEmail === ADMIN_PRIMARY_EMAIL;
      const baseUsername = normalizeUsername(fbAccount.email.split('@')[0] || fbAccount.localId);

      let user = store.users.find(
        (u) =>
          u.id === fbAccount.localId ||
          normalizeEmail(u.email) === normalizedEmail ||
          normalizeUsername(u.username) === normalizedEmail ||
          (isBootstrappedAdmin && u.role === 'admin')
      );

      if (!user) {
        let uniqueUsername = baseUsername || `user_${fbAccount.localId.slice(0, 6)}`;
        if (store.users.some((u) => normalizeUsername(u.username) === uniqueUsername)) {
          uniqueUsername = `${uniqueUsername}_${fbAccount.localId.slice(0, 4)}`;
        }
        user = {
          id: fbAccount.localId,
          username: uniqueUsername,
          email: normalizedEmail,
          fullName: (fbAccount.displayName || baseUsername || 'Fayyadamaa Google').trim(),
          role: isBootstrappedAdmin ? 'admin' : 'user',
          passwordHash: '',
          progress: { completedDocIds: [], quizScores: {} },
          createdAt: new Date().toISOString(),
        };
        store.users.push(user);
      } else {
        user.email = normalizedEmail;
        if (fbAccount.displayName?.trim() && (!user.fullName || user.fullName === 'Admin Giddugalaa')) {
          user.fullName = fbAccount.displayName.trim();
        }
        if (isBootstrappedAdmin && user.role !== 'admin') {
          user.role = 'admin';
        }
      }

      if (store.deletedUserIds?.includes(user.id)) {
        store.deletedUserIds = store.deletedUserIds.filter((id) => id !== user!.id);
      }

      let effectiveRole: 'admin' | 'user' = user.role;
      if (expectedRole === 'admin') {
        const userEmail = normalizeEmail(user.email);
        if (userEmail !== ADMIN_PRIMARY_EMAIL) {
          effectiveRole = 'user';
          if (user.role === 'admin') user.role = 'user';
        }
      }

      const token = issueAuthToken(user);
      store.sessions[token] = {
        userId: user.id,
        createdAt: new Date().toISOString(),
      };
      saveStore(store);
      await flushDbSync(3000);

      res.json({ token, user: sanitizeUser(user), effectiveTab: effectiveRole });
    } catch {
      res.status(502).json({ error: 'Firebase waliin walqunnamuun hin danda’amne.' });
    }
  });

  // Auth: register new student user (with Email + Password, optional Username)
  app.post('/api/auth/register', async (req: Request, res: Response) => {
    const store = loadStore();
    const { fullName, email, username, password } = req.body as {
      fullName?: string;
      email?: string;
      username?: string;
      password?: string;
    };

    const cleanFullName = (fullName || '').trim();
    const cleanEmail = normalizeEmail(email);
    let cleanUsername = (username || '').trim();

    if (!cleanFullName || !password || (!cleanEmail && !cleanUsername)) {
      res.status(400).json({
        error: 'Maqaa guutuu, Email (ykn maqaa fayyadamaa), fi Password guutamuu qabu.',
      });
      return;
    }

    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Maaloo Email sirrii ta’e galchi (fkn: maqaa@gmail.com).' });
      return;
    }

    if (password.length < 4) {
      res.status(400).json({ error: 'Password yoo xiqqaate diijiitii/qubee 4 qabaachuu qaba.' });
      return;
    }

    if (cleanEmail && store.users.some((u) => normalizeEmail(u.email) === cleanEmail)) {
      res.status(409).json({
        error: 'Email kun duraan galmaa’eera. Maaloo seenumsa (Login) fayyadami ykn password reset godhi.',
      });
      return;
    }

    if (!cleanUsername && cleanEmail) {
      const emailPrefix = cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '') || 'barataa';
      let candidate = emailPrefix.length >= 3 ? emailPrefix : `${emailPrefix}_user`;
      let suffix = 1;
      while (store.users.some((u) => normalizeUsername(u.username) === normalizeUsername(candidate))) {
        suffix += 1;
        candidate = `${emailPrefix}${suffix}`;
      }
      cleanUsername = candidate;
    }

    if (cleanUsername.length < 3) {
      res.status(400).json({ error: 'Maqaan fayyadamaa yoo xiqqaate qubee 3 qabaachuu qaba.' });
      return;
    }

    const normalized = normalizeUsername(cleanUsername);
    if (store.users.some((u) => normalizeUsername(u.username) === normalized)) {
      res.status(409).json({
        error: 'Maqaan fayyadamaa kun duraan galmaa’eera. Maaloo maqaa biraa filadhu.',
      });
      return;
    }

    const newUser: UserAccount = {
      id: `user-${crypto.randomUUID().slice(0, 8)}`,
      username: cleanUsername,
      ...(cleanEmail ? { email: cleanEmail } : {}),
      fullName: cleanFullName,
      role: 'user',
      passwordHash: hashPassword(password),
      progress: { completedDocIds: [], quizScores: {} },
      createdAt: new Date().toISOString(),
    };

    store.users.push(newUser);
    const token = issueAuthToken(newUser);
    store.sessions[token] = {
      userId: newUser.id,
      createdAt: new Date().toISOString(),
    };
    saveStore(store);
    await flushDbSync(3000);

    res.status(201).json({ token, user: sanitizeUser(newUser) });
  });

  // Auth: reset forgotten password using Email OR Username
  app.post('/api/auth/reset-password', async (req: Request, res: Response) => {
    const store = loadStore();
    const { username, newPassword, expectedRole } = req.body as {
      username?: string;
      newPassword?: string;
      expectedRole?: 'admin' | 'user';
    };

    if (!username?.trim() || !newPassword) {
      res.status(400).json({ error: 'Email ykn maqaa dura ittiin galmoofte fi Password haaraa galchi.' });
      return;
    }

    if (newPassword.length < 4) {
      res.status(400).json({ error: 'Password haaraan yoo xiqqaate qubee/lakkoofsa 4 ta’uu qaba.' });
      return;
    }

    const normalized = normalizeUsername(username);
    const user = store.users.find(
      (u) =>
        normalizeUsername(u.username) === normalized ||
        (u.email && normalizeEmail(u.email) === normalized)
    );
    if (!user) {
      res.status(404).json({
        error: `Fayyadamaan email/maqaa "${username.trim()}" jedhuun galmaa’e hin argamne.`,
      });
      return;
    }

    const userEmail = normalizeEmail(user.email);
    if (userEmail === ADMIN_PRIMARY_EMAIL || user.role === 'admin') {
      res.status(403).json({
        error: 'Akkaawuntiin Admin (danielbiranu.23@gmail.com) kun eegumsaaf password reset godhuuf hin hayyamamu.',
      });
      return;
    }

    if (expectedRole && user.role !== expectedRole) {
      res.status(403).json({
        error:
          expectedRole === 'admin'
            ? 'Akkaawuntiin kun Admin miti. Maaloo tab Barataa irratti reset godhi.'
            : 'Akkaawuntiin kun kan Admin ti. Maaloo tab Admin irratti reset godhi.',
      });
      return;
    }

    user.passwordHash = hashPassword(newPassword);
    saveStore(store);
    await flushDbSync(3000);

    res.json({
      ok: true,
      message: `Password "${user.email || user.username}" milkaa’inaan haaromfameera. Amma seenuu dandeessa.`,
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
      documents: activeDocs.map(sanitizeDocumentForClient),
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
      documents: [...store.documents].sort((a, b) => a.order - b.order).map(sanitizeDocumentForClient),
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
  app.post(
    '/api/admin/documents/upload',
    (req: Request, res: Response, next: express.NextFunction) => {
      upload.array('files', 10)(req, res, (err: unknown) => {
        if (err) {
          const msg =
            err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
              ? 'Faayilli garmalee guddaa dha (daangaan 30MB dha).'
              : err instanceof Error
                ? err.message
                : 'Faayila ol-kaa’uun hin danda’amne.';
          res.status(400).json({ error: msg });
          return;
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      const store = loadStore();
      const user = getAuthenticatedUser(req, store);
      const files = (req.files as Express.Multer.File[]) || [];

      const cleanupFiles = (list: Express.Multer.File[]) => {
        for (const f of list) {
          if (f.path && fs.existsSync(f.path)) {
            try {
              fs.unlinkSync(f.path);
            } catch {
              // ignore
            }
          }
        }
      };

      if (!user || user.role !== 'admin') {
        cleanupFiles(files);
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
        let storedFilePath: string | undefined;
        const mimeType =
          ext === '.pdf'
            ? 'application/pdf'
            : ext === '.md'
              ? 'text/markdown'
              : 'text/plain';

        if (ext !== '.pdf') {
          textContent = readUploadedTextFile(file.path);
          summary = textContent.replace(/[#*_`>-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
          if (summary.length === 180) summary += '...';
          try {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          } catch {
            // ignore
          }
        } else {
          const pdfBytes = fs.readFileSync(file.path);
          if (pdfBytes.length <= MAX_INLINE_PDF_BYTES) {
            storedFilePath = `${PDF_DATA_URI_PREFIX}${pdfBytes.toString('base64')}`;
            try {
              if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            } catch {
              // ignore
            }
          } else {
            storedFilePath = file.path;
          }
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
          storedFilePath,
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
      await flushDbSync(15000);

      if ((supabasePgPool || supabaseRestConfig) && lastSupabaseSyncStatus !== 'ok') {
        const createdIds = new Set(createdDocs.map((d) => d.id));
        store.documents = store.documents.filter((d) => !createdIds.has(d.id));
        cachedStore = store;
        ensureDataDirs();
        fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
        res.status(500).json({
          error:
            lastSupabaseSyncStatus === 'rls_blocked'
              ? 'Supabase Row-Level Security (RLS) kitaaba save gochuu dhorkeera.'
              : 'Kitaaba gara database Supabase save gochuun hin milkoofne. Maaloo irra deebi’ii yaali.',
        });
        return;
      }

      res.status(201).json({
        documents: createdDocs.map(sanitizeDocumentForClient),
        rejected: rejectedNames,
      });
    }
  );

  // Admin: upload a file specifically for Chatbot Instructions / Behavior in Settings
  app.post(
    '/api/admin/settings/instructions-file',
    (req: Request, res: Response, next: express.NextFunction) => {
      upload.single('file')(req, res, (err: unknown) => {
        if (err) {
          const msg =
            err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
              ? 'Faayilli garmalee guddaa dha (daangaan 30MB dha).'
              : err instanceof Error
                ? err.message
                : 'Faayila qajeelfamaa ol-kaa’uun hin danda’amne.';
          res.status(400).json({ error: msg });
          return;
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
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
        if (
          store.settings.instructionPdfPath &&
          !store.settings.instructionPdfPath.startsWith('data:') &&
          fs.existsSync(store.settings.instructionPdfPath)
        ) {
          try {
            fs.unlinkSync(store.settings.instructionPdfPath);
          } catch {
            // ignore
          }
        }
        const pdfBytes = fs.readFileSync(file.path);
        if (pdfBytes.length <= MAX_INLINE_PDF_BYTES) {
          store.settings.instructionPdfPath = `${PDF_DATA_URI_PREFIX}${pdfBytes.toString('base64')}`;
          try {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          } catch {
            // ignore
          }
        } else {
          store.settings.instructionPdfPath = file.path;
        }
        store.settings.instructionFileName = file.originalname;
      } else {
        const content = readUploadedTextFile(file.path).trim();
        fs.unlinkSync(file.path);
        store.settings.systemInstructions = content.slice(0, 20000);
        store.settings.instructionFileName = file.originalname;
        store.settings.instructionPdfPath = undefined;
      }

      saveStore(store);
      await flushDbSync(10000);
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
    }
  );

  // Admin: create text lesson directly in Settings
  app.post('/api/admin/documents/text', async (req: Request, res: Response) => {
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

    const cleanText = content.replace(/\u0000/g, '').trim();
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
    await flushDbSync(10000);
    res.status(201).json({ document: sanitizeDocumentForClient(newDoc) });
  });

  // Admin: update document metadata / active status
  app.patch('/api/admin/documents/:id', async (req: Request, res: Response) => {
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
      doc.textContent = textContent.replace(/\u0000/g, '');
      doc.sizeBytes = Buffer.byteLength(doc.textContent, 'utf8');
      const s = doc.textContent.replace(/[#*_`>-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
      doc.summary = s.length === 180 ? `${s}...` : s;
    }
    doc.updatedAt = new Date().toISOString();

    saveStore(store);
    await flushDbSync(10000);
    res.json({ document: sanitizeDocumentForClient(doc) });
  });

  // Admin: delete document
  app.delete('/api/admin/documents/:id', async (req: Request, res: Response) => {
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
    syncedSupabaseDocSignatures.delete(removed.id);
    if (
      removed.storedFilePath &&
      !removed.storedFilePath.startsWith('data:') &&
      fs.existsSync(removed.storedFilePath)
    ) {
      try {
        fs.unlinkSync(removed.storedFilePath);
      } catch {
        // Ignore cleanup errors
      }
    }
    saveStore(store);
    await flushDbSync(10000);
    res.json({ deleted: true });
  });

  // Admin: update settings
  app.put('/api/admin/settings', async (req: Request, res: Response) => {
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
    await flushDbSync(5000);
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

  // Admin: update own Admin email, username & password
  app.put('/api/admin/credentials', async (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Aangoon Admin barbaachisaa dha.' });
      return;
    }

    const { fullName, email, username, newPassword } = req.body as {
      fullName?: string;
      email?: string;
      username?: string;
      newPassword?: string;
    };

    if (email?.trim()) {
      const cleanEmail = normalizeEmail(email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        res.status(400).json({ error: 'Email sirrii ta’e galchi.' });
        return;
      }
      const conflictEmail = store.users.find(
        (u) => u.id !== user.id && normalizeEmail(u.email) === cleanEmail
      );
      if (conflictEmail) {
        res.status(409).json({ error: 'Email kun fayyadamaa biraatiin qabameera.' });
        return;
      }
      user.email = cleanEmail;
    }

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
    await flushDbSync(5000);
    res.json({ user: sanitizeUser(user) });
  });

  // Admin: delete a registered student account (protects admin accounts & self)
  app.delete('/api/admin/users/:id', async (req: Request, res: Response) => {
    const store = loadStore();
    const adminUser = getAuthenticatedUser(req, store);
    if (!adminUser || adminUser.role !== 'admin') {
      res.status(403).json({ error: 'Aangoon Admin barbaachisaa dha.' });
      return;
    }

    const targetId = String(req.params.id || '').trim();
    if (!targetId) {
      res.status(400).json({ error: 'Eenyummaan barataa hin kennamne.' });
      return;
    }

    const idx = store.users.findIndex((u) => u.id === targetId);
    if (idx === -1) {
      res.status(404).json({ error: 'Barataan kun hin argamne.' });
      return;
    }

    const target = store.users[idx];
    if (target.id === adminUser.id || target.role === 'admin') {
      res.status(400).json({
        error: 'Akkaawuntii Admin haquun hin danda’amu; barattoota qofa haquu dandeessa.',
      });
      return;
    }

    store.users.splice(idx, 1);
    store.deletedUserIds = Array.from(new Set([...(store.deletedUserIds || []), target.id]));
    store.chats = store.chats.filter((c) => c.userId !== target.id);
    store.notes = (store.notes || []).filter((n) => n.userId !== target.id);
    for (const [token, rec] of Object.entries(store.sessions)) {
      if (rec.userId === target.id) {
        delete store.sessions[token];
      }
    }

    saveStore(store);
    await flushDbSync(10000);
    res.json({ deleted: true, deletedUserId: target.id });
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
  app.post('/api/admin/bible/import-book', async (req: Request, res: Response) => {
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
    await flushDbSync(15000);

    res.status(201).json({ document: sanitizeDocumentForClient(created) });
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

  // Serve PDF/file download & inline preview for a study document (with Supabase live fallback)
  app.get('/api/documents/:id/file', async (req: Request, res: Response) => {
    const store = loadStore();
    let doc = store.documents.find((d) => d.id === req.params.id);
    let fileBuf = doc ? readStoredPdfBuffer(doc.storedFilePath) : null;

    if (!doc || (doc.mimeType === 'application/pdf' && !fileBuf)) {
      try {
        let remoteRow: Record<string, unknown> | null = null;
        if (supabasePgPool) {
          const q = await supabasePgPool.query(
            'SELECT * FROM study_documents WHERE id = $1 LIMIT 1',
            [req.params.id]
          );
          if (q.rows.length > 0) remoteRow = q.rows[0] as Record<string, unknown>;
        } else if (supabaseRestConfig) {
          const resp = await supabaseRestFetch(
            supabaseRestConfig,
            `study_documents?id=eq.${encodeURIComponent(req.params.id)}&limit=1`
          );
          if (resp.ok) {
            const rows = (await resp.json()) as Array<Record<string, unknown>>;
            if (rows.length > 0) remoteRow = rows[0];
          }
        }

        if (remoteRow) {
          const remoteDoc: StudyDocument = {
            id: String(remoteRow.id),
            order: Number(remoteRow.sort_order ?? remoteRow.order ?? 1),
            title: String(remoteRow.title || 'Barnoota'),
            category: String(remoteRow.category || 'Barnoota Waliigalaa'),
            fileName: String(remoteRow.file_name || 'document.pdf'),
            mimeType: String(remoteRow.mime_type || 'application/pdf'),
            sizeBytes: Number(remoteRow.size_bytes || 0),
            sourceType:
              remoteRow.source_type === 'upload' || remoteRow.source_type === 'lesson'
                ? remoteRow.source_type
                : 'starter',
            active: Boolean(remoteRow.active ?? true),
            summary: String(remoteRow.summary || ''),
            textContent: String(remoteRow.text_content || ''),
            storedFilePath:
              typeof remoteRow.stored_file_path === 'string'
                ? remoteRow.stored_file_path
                : undefined,
            createdAt: String(remoteRow.created_at || new Date().toISOString()),
            updatedAt: String(remoteRow.updated_at || new Date().toISOString()),
          };
          const existingIdx = store.documents.findIndex((d) => d.id === remoteDoc.id);
          if (existingIdx !== -1) {
            store.documents[existingIdx] = remoteDoc;
          } else {
            store.documents.push(remoteDoc);
          }
          doc = remoteDoc;
          fileBuf = readStoredPdfBuffer(doc.storedFilePath);
        }
      } catch (err) {
        console.warn('Supabase fallback lookup for document file failed:', err);
      }
    }

    if (!doc) {
      res.status(404).json({ error: 'Faayilli kun hin argamne.' });
      return;
    }

    const asciiSafe = (doc.fileName || 'document.pdf')
      .replace(/[^\x20-\x7E]+/g, '_')
      .replace(/["\\;]/g, '_');
    const encodedName = encodeURIComponent(doc.fileName || asciiSafe);
    const dispType = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader(
      'Content-Disposition',
      `${dispType}; filename="${asciiSafe}"; filename*=UTF-8''${encodedName}`
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');

    if (fileBuf) {
      res.setHeader('Content-Type', doc.mimeType || 'application/pdf');
      res.setHeader('Content-Length', String(fileBuf.length));
      res.send(fileBuf);
      return;
    }

    if (doc.textContent) {
      const textBuf = Buffer.from(doc.textContent, 'utf8');
      res.setHeader('Content-Type', `${doc.mimeType === 'application/pdf' ? 'text/plain' : doc.mimeType || 'text/plain'}; charset=utf-8`);
      res.setHeader('Content-Length', String(textBuf.length));
      res.send(textBuf);
      return;
    }

    res.status(404).json({ error: 'Qabiyyeen faayila kanaa hin argamne.' });
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

    const ai = getAiClient();
    if (!ai) {
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
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
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
    const docParts = buildDocumentParts(targetDocs, store.settings, message.trim());

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
            text: `The student's name is "${user.fullName}". Use the Bilingual 66-Book Bible passages and study materials attached above as your foundation for teaching and giving wise, faithful biblical counsel.`,
          },
        ],
      },
      {
        role: 'model',
        parts: [
          {
            text: 'Tole, sagalee Macaafa Qulqulluu fi barnoota qophaa’an sirriitti hubadheera. Gaaffii barnootaa fi gorsa hafuuraa dhugaa kennuuf qophaa’eera.',
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

    const ai = getAiClient();
    if (!ai) {
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
      const runGeminiStream = async () => {
        const stream = await ai.models.generateContentStream({
          model: 'gemini-4-hydrogen',
          contents,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          },
        });
        for await (const chunk of stream) {
          const text = chunk.text ?? '';
          if (text) {
            fullReply += text;
            res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
          }
        }
      };

      try {
        await runGeminiStream();
      } catch (firstErr) {
        if (!fullReply) {
          console.warn('Retrying Gemini chat stream once after transient error:', firstErr);
          await runGeminiStream();
        } else {
          throw firstErr;
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

  // Role & owner-isolated Personal Notes (Admin notes kept separate from Student notes)
  app.get('/api/notes', (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }

    const notes = (store.notes || [])
      .filter((n) => n.userId === user.id && n.ownerRole === user.role)
      .slice()
      .sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      });

    res.json({ notes, ownerRole: user.role });
  });

  app.post('/api/notes', async (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }

    const { title, content, category, scriptureRef, pinned } = req.body as {
      title?: string;
      content?: string;
      category?: string;
      scriptureRef?: string;
      pinned?: boolean;
    };

    const cleanTitle = (title || '').trim().slice(0, 200);
    const cleanContent = (content || '').trim().slice(0, 20000);
    if (!cleanTitle || !cleanContent) {
      res.status(400).json({ error: 'Mata-duree fi qabiyyeen yaadannoo guutamuu qabu.' });
      return;
    }

    const now = new Date().toISOString();
    const newNote: PersonalNote = {
      id: `note-${crypto.randomUUID().slice(0, 10)}`,
      userId: user.id,
      ownerRole: user.role,
      title: cleanTitle,
      content: cleanContent,
      category: (category || '').trim().slice(0, 80) || (user.role === 'admin' ? 'Qophii Barsiisaa' : 'Qo’annoo Macaafaa'),
      ...(scriptureRef?.trim() ? { scriptureRef: scriptureRef.trim().slice(0, 120) } : {}),
      pinned: Boolean(pinned),
      createdAt: now,
      updatedAt: now,
    };

    if (!Array.isArray(store.notes)) store.notes = [];
    store.notes.unshift(newNote);
    saveStore(store);
    await flushDbSync(3000);

    res.status(201).json({ note: newNote });
  });

  app.put('/api/notes/:id', async (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }

    const noteId = String(req.params.id || '').trim();
    const note = (store.notes || []).find(
      (n) => n.id === noteId && n.userId === user.id && n.ownerRole === user.role
    );
    if (!note) {
      res.status(404).json({ error: 'Yaadannoon kun hin argamne ykn kan kee miti.' });
      return;
    }

    const { title, content, category, scriptureRef, pinned } = req.body as {
      title?: string;
      content?: string;
      category?: string;
      scriptureRef?: string;
      pinned?: boolean;
    };

    if (typeof title === 'string') {
      const cleanTitle = title.trim().slice(0, 200);
      if (!cleanTitle) {
        res.status(400).json({ error: 'Mata-dureen yaadannoo duwwaa ta’uu hin danda’u.' });
        return;
      }
      note.title = cleanTitle;
    }

    if (typeof content === 'string') {
      const cleanContent = content.trim().slice(0, 20000);
      if (!cleanContent) {
        res.status(400).json({ error: 'Qabiyyeen yaadannoo duwwaa ta’uu hin danda’u.' });
        return;
      }
      note.content = cleanContent;
    }

    if (typeof category === 'string' && category.trim()) {
      note.category = category.trim().slice(0, 80);
    }

    if (typeof scriptureRef === 'string') {
      const cleanRef = scriptureRef.trim().slice(0, 120);
      if (cleanRef) {
        note.scriptureRef = cleanRef;
      } else {
        delete note.scriptureRef;
      }
    }

    if (typeof pinned === 'boolean') {
      note.pinned = pinned;
    }

    note.updatedAt = new Date().toISOString();
    saveStore(store);
    await flushDbSync(3000);

    res.json({ note });
  });

  app.delete('/api/notes/:id', async (req: Request, res: Response) => {
    const store = loadStore();
    const user = getAuthenticatedUser(req, store);
    if (!user) {
      res.status(401).json({ error: 'Dura seenuu qabda.' });
      return;
    }

    const noteId = String(req.params.id || '').trim();
    const idx = (store.notes || []).findIndex(
      (n) => n.id === noteId && n.userId === user.id && n.ownerRole === user.role
    );
    if (idx === -1) {
      res.status(404).json({ error: 'Yaadannoon kun hin argamne ykn kan kee miti.' });
      return;
    }

    store.notes!.splice(idx, 1);
    saveStore(store);
    await flushDbSync(3000);

    res.json({ deleted: true, id: noteId });
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
      const vitePkg = ['vi', 'te'].join('');
      const { createServer: createViteServer } = (await import(
        /* @vite-ignore */ vitePkg
      )) as typeof import('vite');
      const isHostedDev = Boolean(
        process.env.DISABLE_HMR === 'true' ||
          process.env.APPLET_ID ||
          process.env.K_SERVICE ||
          process.env.APP_URL
      );
      if (isHostedDev) {
        process.env.DISABLE_HMR = 'true';
      }
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: isHostedDev ? false : httpServer ? { server: httpServer } : false,
          watch: isHostedDev ? null : {},
        },
        appType: 'spa',
      });
      if (isHostedDev) {
        const noWsViteClient = `
const sheetsMap = new Map();
const linkSheetsMap = new Map();
if (typeof document !== 'undefined') {
  document.querySelectorAll('style[data-vite-dev-id]').forEach((el) => {
    sheetsMap.set(el.getAttribute('data-vite-dev-id'), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute('data-vite-dev-id'), el);
  });
}
let lastInsertedStyle;
export function updateStyle(id, content) {
  if (linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => { lastInsertedStyle = undefined; }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement('afterend', style);
    }
    lastInsertedStyle = style;
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  if (linkSheetsMap.has(id)) {
    document.querySelectorAll(\`link[rel="stylesheet"][data-vite-dev-id="\${CSS.escape(id)}"]\`).forEach((el) => el.remove());
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style && style.parentNode) {
    style.parentNode.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  const noop = () => {};
  return {
    data: {},
    accept: noop,
    acceptExports: noop,
    dispose: noop,
    prune: noop,
    decline: noop,
    invalidate: noop,
    on: noop,
    off: noop,
    send: noop,
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return \`\${pathname}?\${queryToInject}\${search ? '&' + search.slice(1) : ''}\${hash || ''}\`;
}
export class ErrorOverlay extends (typeof HTMLElement !== 'undefined' ? HTMLElement : Object) {}
`;
        app.get('/@vite/client', (_req: Request, res: Response) => {
          res.setHeader('Cache-Control', 'no-store');
          res.type('application/javascript; charset=utf-8').send(noWsViteClient);
        });
      }
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
  const httpServer = http.createServer();
  createApp(httpServer)
    .then((app) => {
      httpServer.on('request', app);
      httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`Server listening on http://0.0.0.0:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}
