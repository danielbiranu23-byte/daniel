import { authHeaders, safeJson } from './api';
import { auth, saveChatThreadWithMessagesToFirestore } from './firebase';
import {
  cacheChats,
  getCachedBibleBundle,
  getCachedChats,
  type OfflineBibleBook,
  type OfflineBibleBundle,
} from './offlineStore';
import type { BibleSearchHit, ChatMessage, ChatThread, StudyDocument } from '../types';

const BOOK_ALIASES: Array<{ id: string; terms: string[] }> = [
  { id: 'GEN', terms: ['uumama', 'seera uumamaa', 'genesis', 'gen'] },
  { id: 'EXO', terms: ['ba uu', 'seera ba uu', 'exodus', 'exo'] },
  { id: 'LEV', terms: ['leewota', 'leviticus', 'lev'] },
  { id: 'NUM', terms: ['lakkoofsa', 'numbers', 'num'] },
  { id: 'DEU', terms: ['keessa deebii', 'deuteronomy', 'deu'] },
  { id: 'JOS', terms: ['iyaasuu', 'joshua', 'jos'] },
  { id: 'JDG', terms: ['abboota firdii', 'judges', 'jdg'] },
  { id: 'RUT', terms: ['ruut', 'ruth', 'rut'] },
  { id: 'PSA', terms: ['faarfannaa', 'farfanna', 'faarf', 'faar', 'psalm', 'psalms', 'psa'] },
  { id: 'PRO', terms: ['fakkeenya', 'fakk', 'proverbs', 'prov', 'pro'] },
  { id: 'ISA', terms: ['isaayaas', 'isaayas', 'isa', 'isaiah'] },
  { id: 'JER', terms: ['ermiyaas', 'ermiyas', 'jeremiah', 'jer'] },
  { id: 'DAN', terms: ['daani eel', 'daniel', 'dan'] },
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
  { id: 'HEB', terms: ['ibroota', 'ibrota', 'ibr', 'hebrews', 'heb'] },
  { id: 'JAS', terms: ['yaaqoob', 'yaqob', 'yaaq', 'james', 'jas'] },
  { id: 'REV', terms: ['mul ata', 'mulata', 'mul', 'revelation', 'rev'] },
];

const GRACEFUL_UNAVAILABLE =
  "Odeeffannoon hin jire, ammaaf isiniif deebisuu hin dandeenye; maaloo nagaan Waaqayyoo siif haa baay'atu! Eebbifami!";

function normStr(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9:\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface OfflineCounselTopic {
  id: string;
  titleOm: string;
  titleEn: string;
  keywords: string[];
  refs: Array<{ bookId: string; chapter: number; verseStart: number; verseEnd?: number }>;
  guidanceOm: string;
  guidanceEn: string;
}

const OFFLINE_COUNSEL_TOPICS: OfflineCounselTopic[] = [
  {
    id: 'anxiety_peace',
    titleOm: 'Dhiphina, Yaaddoo fi Nagaa Waaqayyoo',
    titleEn: 'Anxiety, Worry & God’s Peace',
    keywords: ['dhiphina', 'yaaddoo', 'yaddo', 'nagaa', 'boqonnaa', 'anxiety', 'anxious', 'worry', 'stress', 'peace'],
    refs: [
      { bookId: 'PHP', chapter: 4, verseStart: 6, verseEnd: 7 },
      { bookId: 'MAT', chapter: 11, verseStart: 28, verseEnd: 30 },
      { bookId: '1PE', chapter: 5, verseStart: 7 },
    ],
    guidanceOm:
      'Yeroo dhiphinni fi yaaddoon sitti dhufu: (1) Waan si yaaddessu hunda kadhannaa fi galataan Waaqayyotti himi (Filiphisiyus 4:6-7); (2) Ba’aa kee hundumaa isatti gati, inni siif yaada (1 Pheexiroos 5:7); (3) Sammuu kee sagalee Waaqayyoo keessa boqochiisi.',
    guidanceEn:
      'Bring every concern to God in prayer with thanksgiving (Philippians 4:6-7) and cast all your anxieties on Him because He cares for you (1 Peter 5:7).',
  },
  {
    id: 'fear_courage',
    titleOm: 'Sodaa Mo’uu fi Jajjabina',
    titleEn: 'Overcoming Fear & Finding Courage',
    keywords: ['sodaa', 'sodaachuu', 'jajjabina', 'humna', 'fear', 'afraid', 'courage', 'strength'],
    refs: [
      { bookId: 'ISA', chapter: 41, verseStart: 10 },
      { bookId: '2TI', chapter: 1, verseStart: 7 },
      { bookId: 'PSA', chapter: 23, verseStart: 1, verseEnd: 4 },
    ],
    guidanceOm:
      'Sodaan yoo si qabatu Waaqayyo si wajjin akka jiru yaadadhu (Isaayaas 41:10). Waaqayyo hafuura humnaa, jaalalaa fi of-qabuu nuuf kenneera malee hafuura sodaa miti (2 Ximootewos 1:7).',
    guidanceEn:
      'Do not be afraid, for God is with you (Isaiah 41:10) and has given you a spirit of power, love, and self-control (2 Timothy 1:7).',
  },
  {
    id: 'wisdom_counsel',
    titleOm: 'Ogummaa, Murtoo Sirrii fi Qajeelcha',
    titleEn: 'Wisdom & Right Decisions',
    keywords: ['gorsa', 'gorsu', 'gorsita', 'ogummaa', 'murtoo', 'filannoo', 'karaa', 'advice', 'counsel', 'wisdom', 'decision', 'guidance'],
    refs: [
      { bookId: 'PRO', chapter: 3, verseStart: 5, verseEnd: 6 },
      { bookId: 'JAS', chapter: 1, verseStart: 5 },
      { bookId: 'PSA', chapter: 119, verseStart: 105 },
    ],
    guidanceOm:
      'Murtoo sirrii gochuuf: (1) Garaa kee guutuudhaan Waaqayyoon amanadhu malee hubannaa keetti hin hirkatini (Fakkeenya 3:5-6); (2) Ogummaa yoo dhabde Waaqayyoon kadhadhu, inni arjummaadhaan ni kenna (Yaaqoob 1:5); (3) Sagalee Waaqayyoo ifa karaa kee godhadhu.',
    guidanceEn:
      'Trust in the Lord with all your heart (Proverbs 3:5-6) and ask God generously for wisdom in prayer (James 1:5).',
  },
  {
    id: 'forgiveness_repentance',
    titleOm: 'Dhiifama, Qalbii Jijjiirrannaa fi Araara',
    titleEn: 'Forgiveness & Repentance',
    keywords: ['dhiifama', 'cubbuu', 'qalbii', 'araara', 'forgive', 'forgiveness', 'repent', 'sin', 'guilt'],
    refs: [
      { bookId: '1JN', chapter: 1, verseStart: 9 },
      { bookId: 'EPH', chapter: 4, verseStart: 32 },
      { bookId: 'COL', chapter: 3, verseStart: 13 },
    ],
    guidanceOm:
      'Cubbuu ofii himannee yoo deebine Waaqayyo nuuf dhiisa, nu qulqulleessas (1 Yohaannis 1:9). Akkuma Kiristoos nuuf dhiise nutis garaa laafnee walii dhiisuun nagaa arganna (Efesoon 4:32).',
    guidanceEn:
      'Confess openly to God who is faithful to forgive (1 John 1:9) and forgive others tenderly as Christ forgave you (Ephesians 4:32).',
  },
  {
    id: 'salvation_grace',
    titleOm: 'Fayyina, Ayyaanaa fi Kiristoos',
    titleEn: 'Salvation & Grace',
    keywords: ['fayyina', 'ayyaana', 'yesuus', 'kiristoos', 'amantii', 'salvation', 'grace', 'jesus', 'christ', 'gospel'],
    refs: [
      { bookId: 'JHN', chapter: 3, verseStart: 16 },
      { bookId: 'EPH', chapter: 2, verseStart: 8, verseEnd: 9 },
      { bookId: 'ROM', chapter: 10, verseStart: 9, verseEnd: 10 },
    ],
    guidanceOm:
      'Fayyinni ayyaana Waaqayyootiin amantii Yesuus Kiristoos irratti qabnuun tola kennama (Efesoon 2:8-9; Yohaannis 3:16; Roomaa 10:9-10).',
    guidanceEn:
      'Salvation is God’s free gift of grace received through faith in Jesus Christ (John 3:16; Ephesians 2:8-9).',
  },
  {
    id: 'marriage_family',
    titleOm: 'Gaa’ela, Maatii fi Jaalala',
    titleEn: 'Marriage & Family Love',
    keywords: ['gaa ela', 'gaela', 'fuudha', 'heeruma', 'maatii', 'jaalala', 'marriage', 'husband', 'wife', 'family', 'love'],
    refs: [
      { bookId: 'EPH', chapter: 5, verseStart: 25, verseEnd: 33 },
      { bookId: '1CO', chapter: 13, verseStart: 4, verseEnd: 7 },
      { bookId: 'COL', chapter: 3, verseStart: 13, verseEnd: 14 },
    ],
    guidanceOm:
      'Maatii fi gaa’ela keessatti jaalala obsa qabu, wal-kabajuu, dafanii dhiifama walii gochuu fi waliin kadhachuu cimsaa (1 Qorontos 13:4-7; Efesoon 5:25-33).',
    guidanceEn:
      'Build marriage and family on patient, selfless love, mutual respect, swift forgiveness, and shared prayer (1 Corinthians 13:4-7; Ephesians 5:25-33).',
  },
  {
    id: 'prayer_life',
    titleOm: 'Kadhannaa fi Waaqayyo Waliin Haasa’uu',
    titleEn: 'Prayer Life',
    keywords: ['kadhannaa', 'kadhaa', 'kadhachuu', 'pray', 'prayer'],
    refs: [
      { bookId: 'MAT', chapter: 6, verseStart: 9, verseEnd: 13 },
      { bookId: '1TH', chapter: 5, verseStart: 16, verseEnd: 18 },
      { bookId: 'MAT', chapter: 7, verseStart: 7 },
    ],
    guidanceOm:
      'Kadhannaa keessatti Waaqayyoon galateeffadhu, fedhii isaa barbaadi, obsaanis itti fufi (Maatewos 6:9-13; 1 Tasalonqee 5:16-18).',
    guidanceEn:
      'Pray with worship, gratitude, surrender to God’s will, and perseverance (Matthew 6:9-13; 1 Thessalonians 5:16-18).',
  },
  {
    id: 'patience_trials',
    titleOm: 'Obsaa fi Qormaata Keessatti Abdii Qabaachuu',
    titleEn: 'Patience, Trials & Hope',
    keywords: ['obsa', 'obsaa', 'rakkoo', 'qormaata', 'gadda', 'abdii', 'patience', 'trials', 'grief', 'sad', 'hope'],
    refs: [
      { bookId: 'ROM', chapter: 8, verseStart: 28 },
      { bookId: 'JAS', chapter: 1, verseStart: 2, verseEnd: 4 },
      { bookId: 'PSA', chapter: 34, verseStart: 18 },
    ],
    guidanceOm:
      'Yeroo rakkinaa fi gaddaa Waaqayyo warra garaan cabe bira dhiyoo jira (Faarfannaa 34:18); waan hundumaas warra isa jaallataniif gaariidhaaf walitti fida (Roomaa 8:28).',
    guidanceEn:
      'God is near to the brokenhearted (Psalm 34:18) and works all things together for good for those who love Him (Romans 8:28).',
  },
];

function lookupTopicVersesOffline(
  bundle: OfflineBibleBundle | null,
  refs: Array<{ bookId: string; chapter: number; verseStart: number; verseEnd?: number }>
): BibleSearchHit[] {
  if (!bundle) return [];
  const hits: BibleSearchHit[] = [];
  for (const r of refs) {
    const book = bundle.books.find((b) => b.id === r.bookId);
    if (!book) continue;
    const ch = book.chapters.find((c) => c.n === r.chapter);
    if (!ch) continue;
    const endV = r.verseEnd ?? r.verseStart;
    for (const [num, om, en] of ch.v) {
      if (num >= r.verseStart && num <= endV) {
        hits.push({
          bookId: book.id,
          omName: book.omName,
          enName: book.enName,
          chapter: r.chapter,
          verse: num,
          om,
          en,
        });
      }
    }
  }
  return hits;
}

export function searchOfflineBibleBundle(
  bundle: OfflineBibleBundle | null,
  query: string,
  testament: 'all' | 'old' | 'new' = 'all'
): BibleSearchHit[] {
  if (!bundle) return [];
  const normQ = normStr(query);
  if (!normQ) return [];

  const pool = bundle.books.filter((b) => testament === 'all' || b.testament === testament);
  let matchedBook: OfflineBibleBook | undefined;

  for (const b of pool) {
    const terms = [normStr(b.omName), normStr(b.enName)];
    const alias = BOOK_ALIASES.find((a) => a.id === b.id);
    if (alias) terms.push(...alias.terms);
    for (const term of terms) {
      if (term.length >= 3 && new RegExp(`(^|\\s)${term}(\\s|$)`).test(normQ)) {
        matchedBook = b;
        break;
      }
    }
    if (matchedBook) break;
  }

  if (matchedBook) {
    const refMatch = normQ.match(/\b(\d{1,3})(?:\s*:\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?)?\b/);
    const chNum = refMatch ? Number(refMatch[1]) : 1;
    const vStart = refMatch?.[2] ? Number(refMatch[2]) : null;
    const vEnd = refMatch?.[3] ? Number(refMatch[3]) : vStart;
    const ch = matchedBook.chapters.find((c) => c.n === chNum);
    if (ch) {
      const verses = vStart
        ? ch.v.filter(([n]) => n >= vStart && n <= (vEnd || vStart))
        : ch.v.slice(0, 20);
      return verses.map(([num, om, en]) => ({
        bookId: matchedBook.id,
        omName: matchedBook.omName,
        enName: matchedBook.enName,
        chapter: chNum,
        verse: num,
        om,
        en,
      }));
    }
  }

  const terms = normQ.split(/\s+/).filter((w) => w.length >= 3).slice(0, 4);
  if (terms.length === 0) return [];

  const scored: Array<{ score: number; hit: BibleSearchHit }> = [];
  for (const b of pool) {
    for (const ch of b.chapters) {
      for (const [num, om, en] of ch.v) {
        const combined = `${om} ${en}`.toLowerCase();
        let score = 0;
        for (const t of terms) {
          if (combined.includes(t)) score++;
        }
        if (score > 0) {
          scored.push({
            score,
            hit: {
              bookId: b.id,
              omName: b.omName,
              enName: b.enName,
              chapter: ch.n,
              verse: num,
              om,
              en,
            },
          });
        }
      }
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 20).map((s) => s.hit);
}

export function generateLocalOfflineReply(
  query: string,
  targetDocs: StudyDocument[],
  bundle: OfflineBibleBundle | null
): string {
  const norm = normStr(query);
  const isGreeting =
    /^(akkam|akkam jirtu|akkam jirta|selam|salaam|nagaan|nagaa|naguma|hello|hi|hey|good morning|galatoomi|thanks)\b/.test(
      norm
    ) && norm.split(/\s+/).length <= 5;

  if (isGreeting) {
    return "Nagaan Waaqayyoo siif haa baay'atu! Akkam jirta? Yeroo ammaa offline ta'us, gaaffii Macaafa Qulqulluu, gorsa hafuuraa fi barnoota keessaa barbaadde hunda Afaan Oromo fi English dhaan na gaafachuu dandeessa.";
  }

  const sections: string[] = [];

  // Check counsel topics first
  const matchedTopic = OFFLINE_COUNSEL_TOPICS.find((t) =>
    t.keywords.some((kw) => norm.includes(normStr(kw)))
  );
  const isCounselPrompt = /\b(gorsa|gorsu|gorsita|advice|counsel|help|guide)\b/.test(norm);

  if (matchedTopic) {
    sections.push(`### ${matchedTopic.titleOm}\n\n**Gorsa Sirrii fi Qabatamaa:**\n${matchedTopic.guidanceOm}`);
    const topicHits = lookupTopicVersesOffline(bundle, matchedTopic.refs).slice(0, 6);
    if (topicHits.length > 0) {
      sections.push(
        `**Sagalee Macaafa Qulqulluu (Afaan Oromo & English):**\n\n${topicHits
          .map((h) => `**${h.omName} (${h.enName}) ${h.chapter}:${h.verse}**\n- Afaan Oromo: ${h.om}\n- English: *${h.en}*`)
          .join('\n\n')}`
      );
    }
  } else if (isCounselPrompt) {
    const wisdom = OFFLINE_COUNSEL_TOPICS.find((t) => t.id === 'wisdom_counsel')!;
    sections.push(`### ${wisdom.titleOm}\n\n**Gorsa Qabatamaa:**\n${wisdom.guidanceOm}`);
    const wHits = lookupTopicVersesOffline(bundle, wisdom.refs).slice(0, 4);
    if (wHits.length > 0) {
      sections.push(
        wHits
          .map((h) => `**${h.omName} (${h.enName}) ${h.chapter}:${h.verse}**\n- Afaan Oromo: ${h.om}\n- English: *${h.en}*`)
          .join('\n\n')
      );
    }
  }

  // Check Kakuu Moofaa / Kakuu Haaraa overview query
  const wantsOld = /\b(kakuu\s+moofaa|old\s+testament)\b/.test(norm);
  const wantsNew = /\b(kakuu\s+haaraa|kakuu\s+haraa|new\s+testament)\b/.test(norm);
  if (bundle && (wantsOld || wantsNew)) {
    if (wantsOld) {
      const list = bundle.books
        .filter((b) => b.testament === 'old')
        .map((b) => `${b.order}. ${b.omName} (${b.enName})`)
        .join(', ');
      sections.push(`**Kitaabota Kakuu Moofaa (Old Testament — 39):**\n${list}`);
    }
    if (wantsNew) {
      const list = bundle.books
        .filter((b) => b.testament === 'new')
        .map((b) => `${b.order}. ${b.omName} (${b.enName})`)
        .join(', ');
      sections.push(`**Kitaabota Kakuu Haaraa (New Testament — 27):**\n${list}`);
    }
  }

  // Search 66-book Bible
  const hits = searchOfflineBibleBundle(bundle, query, 'all').slice(0, 10);
  if (hits.length > 0 && !matchedTopic) {
    const formatted = hits
      .map(
        (h) =>
          `**${h.omName} (${h.enName}) ${h.chapter}:${h.verse}**\n- Afaan Oromo: ${h.om}\n- English: *${h.en}*`
      )
      .join('\n\n');
    sections.push(`Kunoo sagalee Macaafa Qulqulluu Afaan Oromo fi English dhaan:\n\n${formatted}`);
  }

  // Search Admin study documents
  const stopWords = new Set([
    'maal', 'maali', 'eenyu', 'akkam', 'yoom', 'eessa', 'irratti', 'keessatti',
    'kessatti', 'fi', 'ykn', 'kan', 'isa', 'isaa', 'naaf', 'nuuf', 'akka', 'jira',
    'what', 'who', 'how', 'when', 'where', 'why', 'the', 'and', 'for', 'with',
    'about', 'from', 'that', 'this', 'afaan', 'oromo', 'english', 'lamaaniin', 'gorsa',
  ]);
  const keywords = norm.split(/\s+/).filter((w) => w.length >= 3 && !stopWords.has(w));
  if (keywords.length > 0 && targetDocs.length > 0) {
    const docMatches: Array<{ score: number; snippet: string }> = [];
    for (const doc of targetDocs) {
      if (!doc.textContent) continue;
      for (const block of doc.textContent.split(/\n{2,}/)) {
        if (block.trim().length < 20) continue;
        const lower = block.toLowerCase();
        let score = 0;
        for (const kw of keywords) {
          if (lower.includes(kw)) score++;
        }
        if (score > 0) {
          docMatches.push({ score, snippet: block.trim().slice(0, 900) });
        }
      }
    }
    docMatches.sort((a, b) => b.score - a.score);
    if (docMatches.length > 0) {
      sections.push(
        docMatches
          .slice(0, 2)
          .map((m) => m.snippet)
          .join('\n\n')
      );
    }
  }

  if (sections.length > 0) {
    return sections.join('\n\n');
  }

  return GRACEFUL_UNAVAILABLE;
}

export async function sendChatMessageSeamless(params: {
  threadId: string | null;
  message: string;
  focusDocId: string | 'all';
  documents: StudyDocument[];
  chats: ChatThread[];
  onChunk: (fullTextSoFar: string) => void;
  onComplete: (resolvedThreadId: string, updatedOfflineChats?: ChatThread[]) => Promise<void>;
}): Promise<void> {
  const { threadId, message, focusDocId, documents, chats, onChunk, onComplete } = params;
  const trimmed = message.trim();

  const runOfflineFallback = async () => {
    const bundle = await getCachedBibleBundle();
    const targetDocs =
      focusDocId !== 'all' ? documents.filter((d) => d.id === focusDocId) : documents;
    const reply = generateLocalOfflineReply(trimmed, targetDocs, bundle);

    // Smooth visual streaming effect even offline
    onChunk(reply);

    const now = new Date().toISOString();
    const cachedList = await getCachedChats();
    const baseChats = cachedList.length > 0 ? cachedList.slice() : chats.slice();
    let thread = baseChats.find((c) => c.id === threadId);

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-u`,
      role: 'user',
      content: trimmed,
      createdAt: now,
    };
    const assistantMsg: ChatMessage = {
      id: `msg-${Date.now()}-a`,
      role: 'assistant',
      content: reply,
      createdAt: now,
    };

    if (!thread) {
      thread = {
        id: threadId || `offline-${Date.now()}`,
        userId: 'offline-user',
        title: trimmed.slice(0, 48),
        focusDocId,
        messages: [userMsg, assistantMsg],
        createdAt: now,
        updatedAt: now,
      };
      baseChats.unshift(thread);
    } else {
      thread = {
        ...thread,
        messages: [...thread.messages, userMsg, assistantMsg],
        updatedAt: now,
      };
      const idx = baseChats.findIndex((c) => c.id === thread!.id);
      if (idx !== -1) baseChats[idx] = thread;
    }

    await cacheChats(baseChats);
    if (auth.currentUser?.emailVerified && typeof navigator !== 'undefined' && navigator.onLine) {
      await saveChatThreadWithMessagesToFirestore(auth.currentUser.uid, thread).catch(() => {});
    }
    await onComplete(thread.id, baseChats);
  };

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await runOfflineFallback();
    return;
  }

  try {
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        threadId: threadId || undefined,
        message: trimmed,
        focusDocId,
      }),
    });

    if (!response.ok || !response.body) {
      await runOfflineFallback();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let resolvedThreadId: string = threadId || '';
    let accumulated = '';
    let receivedDone = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;
        try {
          const event = JSON.parse(jsonStr);
          if (event.type === 'meta' && event.threadId) {
            resolvedThreadId = event.threadId;
          } else if (event.type === 'chunk' && event.text) {
            accumulated += event.text;
            onChunk(accumulated);
          } else if (event.type === 'done') {
            receivedDone = true;
            const finalId = resolvedThreadId || threadId || '';
            if (auth.currentUser?.emailVerified && finalId) {
              try {
                const chatsRes = await fetch('/api/chats', { headers: authHeaders() });
                if (chatsRes.ok) {
                  const chatsData = await safeJson<{ chats?: ChatThread[] }>(chatsRes);
                  const latestThread = (chatsData.chats || []).find((c) => c.id === finalId);
                  if (latestThread) {
                    await saveChatThreadWithMessagesToFirestore(
                      auth.currentUser.uid,
                      latestThread
                    );
                  }
                }
              } catch {
                // Best-effort cloud sync after SSE completion
              }
            }
            await onComplete(finalId);
          }
        } catch {
          // ignore malformed SSE fragment
        }
      }
    }

    if (!receivedDone) {
      await runOfflineFallback();
    }
  } catch {
    await runOfflineFallback();
  }
}
