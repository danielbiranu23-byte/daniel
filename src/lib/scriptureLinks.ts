import type { BibleReferenceTarget } from '../types';

interface BookMatchEntry {
  id: string;
  names: string[];
}

// All 66 Bible books with Afaan Oromo names, common spellings, abbreviations, and English names
const BOOK_ENTRIES: BookMatchEntry[] = [
  { id: 'GEN', names: ['Seera Uumamaa', 'Uumama', 'Uum', 'Genesis', 'Gen'] },
  { id: 'EXO', names: ['Seera Ba’uu', "Seera Ba'uu", 'Seera Bauu', 'Ba’uu', "Ba'uu", 'Exodus', 'Exod', 'Exo'] },
  { id: 'LEV', names: ['Seera Leewotaa', 'Leewota', 'Lewota', 'Leviticus', 'Lev'] },
  { id: 'NUM', names: ['Seera Lakkoofsaa', 'Lakkoofsa', 'Lakk', 'Numbers', 'Num'] },
  { id: 'DEU', names: ['Seera Keessa Deebii', 'Keessa Deebii', 'Deuteronomy', 'Deut', 'Deu'] },
  { id: 'JOS', names: ['Kitaaba Iyaasuu', 'Iyaasuu', 'Iyasu', 'Joshua', 'Josh', 'Jos'] },
  { id: 'JDG', names: ['Abboota Firdii', 'Judges', 'Judg', 'Jdg'] },
  { id: 'RUT', names: ['Kitaaba Ruut', 'Ruut', 'Ruth', 'Rut'] },
  { id: '1SA', names: ['1 Saamu’el', "1 Saamu'el", '1 Samuel', '1 Sam', '1Sa'] },
  { id: '2SA', names: ['2 Saamu’el', "2 Saamu'el", '2 Samuel', '2 Sam', '2Sa'] },
  { id: '1KI', names: ['1 Moototaa', '1 Mootota', '1 Kings', '1 Kgs', '1Ki'] },
  { id: '2KI', names: ['2 Moototaa', '2 Mootota', '2 Kings', '2 Kgs', '2Ki'] },
  { id: '1CH', names: ['1 Seenaa Baraa', '1 Chronicles', '1 Chron', '1 Chr', '1Ch'] },
  { id: '2CH', names: ['2 Seenaa Baraa', '2 Chronicles', '2 Chron', '2 Chr', '2Ch'] },
  { id: 'EZR', names: ['Izraa', 'Ezra', 'Ezr'] },
  { id: 'NEH', names: ['Nahimiyaa', 'Nehemiah', 'Neh'] },
  { id: 'EST', names: ['Asteer', 'Esther', 'Est'] },
  { id: 'JOB', names: ['Iyyoob', 'Iyoob', 'Job'] },
  { id: 'PSA', names: ['Faarfannaa Daawit', 'Faarfannaa', 'Farfanna', 'Faarf', 'Faar', 'Psalms', 'Psalm', 'Psa', 'Ps'] },
  { id: 'PRO', names: ['Fakkeenya', 'Fakk', 'Proverbs', 'Prov', 'Pro'] },
  { id: 'ECC', names: ['Lallaba', 'Ecclesiastes', 'Eccl', 'Ecc'] },
  { id: 'SNG', names: ['Weeduu Weedduu Caalu', 'Weedduu Weedduu', 'Song of Solomon', 'Song of Songs', 'Song', 'Sng'] },
  { id: 'ISA', names: ['Isaayaas', 'Isaayas', 'Isa', 'Isaiah'] },
  { id: 'JER', names: ['Ermiyaas', 'Ermiyas', 'Erm', 'Jeremiah', 'Jer'] },
  { id: 'LAM', names: ['Faarfannaa Ermiyaas', 'Lamentations', 'Lam'] },
  { id: 'EZK', names: ['Hizqi’el', "Hizqi'el", 'Hizqiel', 'Ezekiel', 'Ezek', 'Ezk'] },
  { id: 'DAN', names: ['Daani’el', "Daani'el", 'Daaniel', 'Daniel', 'Dan'] },
  { id: 'HOS', names: ['Hose’aa', "Hose'aa", 'Hoseaa', 'Hosea', 'Hos'] },
  { id: 'JOL', names: ['Yo’el', "Yo'el", 'Yoel', 'Joel', 'Jol'] },
  { id: 'AMO', names: ['Aamoos', 'Amos', 'Amo'] },
  { id: 'OBA', names: ['Obadiyaa', 'Obadiah', 'Oba'] },
  { id: 'JON', names: ['Yoonaas', 'Yonas', 'Jonah', 'Jon'] },
  { id: 'MIC', names: ['Miikiyaas', 'Mikiyas', 'Micah', 'Mic'] },
  { id: 'NAM', names: ['Naahum', 'Nahum', 'Nam'] },
  { id: 'HAB', names: ['Anbaaqoom', 'Habakkuk', 'Hab'] },
  { id: 'ZEP', names: ['Sofoniyaas', 'Zephaniah', 'Zeph', 'Zep'] },
  { id: 'HAG', names: ['Haagee', 'Haggai', 'Hag'] },
  { id: 'ZEC', names: ['Zakaariyaas', 'Zakariyas', 'Zechariah', 'Zech', 'Zec'] },
  { id: 'MAL', names: ['Milkiyaas', 'Malachi', 'Mal'] },
  { id: 'MAT', names: ['Maatewos', 'Matewos', 'Maat', 'Matthew', 'Matt', 'Mat'] },
  { id: 'MRK', names: ['Maarqoos', 'Marqos', 'Maarq', 'Mark', 'Mrk'] },
  { id: 'LUK', names: ['Luqaas', 'Luqas', 'Luq', 'Luke', 'Luk'] },
  { id: 'JHN', names: ['Yohaannis', 'Yohannis', 'Yohannes', 'Yohn', 'Yoh', 'John', 'Jhn'] },
  { id: 'ACT', names: ['Hojii Ergamootaa', 'Hojii', 'Acts', 'Act'] },
  { id: 'ROM', names: ['Roomaa', 'Romaa', 'Rom', 'Romans'] },
  { id: '1CO', names: ['1 Qorontos', '1 Qor', '1 Corinthians', '1 Cor', '1Co'] },
  { id: '2CO', names: ['2 Qorontos', '2 Qor', '2 Corinthians', '2 Cor', '2Co'] },
  { id: 'GAL', names: ['Galaatiyaa', 'Galatiya', 'Gal', 'Galatians'] },
  { id: 'EPH', names: ['Efesoon', 'Efeson', 'Efe', 'Ephesians', 'Eph'] },
  { id: 'PHP', names: ['Filiphisiyus', 'Filiphisiyuus', 'Fil', 'Philippians', 'Phil', 'Php'] },
  { id: 'COL', names: ['Qolosaayis', 'Qol', 'Colossians', 'Col'] },
  { id: '1TH', names: ['1 Tasalonqee', '1 Tas', '1 Thessalonians', '1 Thess', '1Th'] },
  { id: '2TH', names: ['2 Tasalonqee', '2 Tas', '2 Thessalonians', '2 Thess', '2Th'] },
  { id: '1TI', names: ['1 Ximootewos', '1 Xim', '1 Timothy', '1 Tim', '1Ti'] },
  { id: '2TI', names: ['2 Ximootewos', '2 Xim', '2 Timothy', '2 Tim', '2Ti'] },
  { id: 'TIT', names: ['Tiitoo', 'Titoo', 'Titus', 'Tit'] },
  { id: 'PHM', names: ['Fiilmoon', 'Filemon', 'Philemon', 'Phlm', 'Phm'] },
  { id: 'HEB', names: ['Ibroota', 'Ibrota', 'Ibr', 'Hebrews', 'Heb'] },
  { id: 'JAS', names: ['Yaaqoob', 'Yaqob', 'Yaaq', 'James', 'Jas'] },
  { id: '1PE', names: ['1 Pheexiroos', '1 Phex', '1 Peter', '1 Pet', '1Pe'] },
  { id: '2PE', names: ['2 Pheexiroos', '2 Phex', '2 Peter', '2 Pet', '2Pe'] },
  { id: '1JN', names: ['1 Yohaannis', '1 Yohn', '1 Yoh', '1 John', '1Jn'] },
  { id: '2JN', names: ['2 Yohaannis', '2 Yohn', '2 Yoh', '2 John', '2Jn'] },
  { id: '3JN', names: ['3 Yohaannis', '3 Yohn', '3 Yoh', '3 John', '3Jn'] },
  { id: 'JUD', names: ['Yihuudaa', 'Yihudaa', 'Jude', 'Jud'] },
  { id: 'REV', names: ['Mul’ata Yohaannis', "Mul'ata Yohaannis", 'Mul’ata', "Mul'ata", 'Mulata', 'Mul', 'Revelation', 'Rev'] },
];

const NAME_TO_BOOK_ID = new Map<string, string>();
const ALL_ESCAPED_NAMES: string[] = [];

for (const entry of BOOK_ENTRIES) {
  for (const name of entry.names) {
    const key = name.toLowerCase().replace(/['’]/g, "'");
    if (!NAME_TO_BOOK_ID.has(key)) {
      NAME_TO_BOOK_ID.set(key, entry.id);
      ALL_ESCAPED_NAMES.push(
        name.replace(/['’]/g, "['’]").replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === '[' || m === ']' ? m : `\\${m}`))
      );
    }
  }
}

// Sort longest first so "1 Yohaannis" matches before "Yohaannis", and "Seera Uumamaa" before "Uumama"
ALL_ESCAPED_NAMES.sort((a, b) => b.length - a.length);

// Matches e.g.:
// - "Yohaannis 14:6"
// - "Yohaannis (John) 14:6"
// - "Maatewos 6:9-13"
// - "2 Ximootewos 3:16"
// - "Luq 12:8"
// - "Romans 8:28"
const SCRIPTURE_REGEX = new RegExp(
  `(?<![A-Za-z0-9\\]\\(])(${ALL_ESCAPED_NAMES.join('|')})(?:\\s*\\([^()]{2,30}\\))?\\s+(\\d{1,3})(?:\\s*:\\s*(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?)?(?![A-Za-z0-9])`,
  'gi'
);

export function linkifyScriptureMarkdown(markdown: string): string {
  if (!markdown) return markdown;

  // Avoid transforming text already inside markdown links [label](url)
  const linkSplit = markdown.split(/(\[[^\]]+\]\([^)]+\))/g);
  return linkSplit
    .map((segment, idx) => {
      if (idx % 2 === 1) return segment;
      return segment.replace(
        SCRIPTURE_REGEX,
        (fullMatch, bookNameRaw: string, chStr: string, vStr?: string) => {
          const normalizedBook = bookNameRaw.toLowerCase().replace(/['’]/g, "'");
          const bookId = NAME_TO_BOOK_ID.get(normalizedBook);
          if (!bookId) return fullMatch;
          const chapter = Number(chStr);
          if (!Number.isFinite(chapter) || chapter < 1 || chapter > 150) return fullMatch;
          const verse = vStr ? Number(vStr) : undefined;
          const target = verse
            ? `#bible-ref:${bookId}:${chapter}:${verse}`
            : `#bible-ref:${bookId}:${chapter}`;
          return `[${fullMatch}](${target})`;
        }
      );
    })
    .join('');
}

export function parseBibleRefHref(href?: string): BibleReferenceTarget | null {
  if (!href || !href.startsWith('#bible-ref:')) return null;
  const parts = href.slice('#bible-ref:'.length).split(':');
  const bookId = parts[0];
  const chapter = Number(parts[1]);
  const verse = parts[2] ? Number(parts[2]) : undefined;
  if (!bookId || !Number.isFinite(chapter) || chapter < 1) return null;
  return {
    bookId,
    chapter,
    verse: verse && Number.isFinite(verse) ? verse : undefined,
    nonce: Date.now(),
  };
}
