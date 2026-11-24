export type LanguageMode = 'om' | 'en' | 'bilingual';
export type GroundingMode = 'strict_files' | 'files_plus_bible';
export type UserRole = 'admin' | 'user';

export interface AuthUser {
  id: string;
  username: string;
  email?: string;
  fullName: string;
  role: UserRole;
  createdAt: string;
}

export interface StudyDocument {
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

export interface PublicAdminSettings {
  tutorName: string;
  welcomeGreeting: string;
  systemInstructions: string;
  instructionFileName?: string;
  languageMode: LanguageMode;
  groundingMode: GroundingMode;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  createdAt: string;
}

export interface ChatThread {
  id: string;
  userId: string;
  title: string;
  focusDocId: string | 'all';
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  scriptureRef: string;
}

export interface StudentProgress {
  completedDocIds: string[];
  quizScores: Record<string, { score: number; total: number; completedAt: string }>;
}

export interface BibleBookCatalogItem {
  id: string;
  order: number;
  omName: string;
  omTitle: string;
  enName: string;
  chapters: number;
  verses: number;
  testament: 'old' | 'new';
  imported: boolean;
}

export interface BibleVersePair {
  number: number;
  om: string;
  en: string;
}

export interface BibleChapterResponse {
  bookId: string;
  omName: string;
  enName: string;
  chapter: number;
  totalChapters: number;
  verses: BibleVersePair[];
}

export interface BibleSearchHit {
  bookId: string;
  omName: string;
  enName: string;
  chapter: number;
  verse: number;
  om: string;
  en: string;
}

export type HighlightColor = 'yellow' | 'blue' | 'green' | 'rose';

export interface BibleHighlight {
  id: string;
  bookId: string;
  omName: string;
  enName: string;
  chapter: number;
  verse: number;
  omText: string;
  enText: string;
  color: HighlightColor;
  note?: string;
  savedAt: string;
}

export interface BibleReferenceTarget {
  bookId: string;
  chapter: number;
  verse?: number;
  nonce?: number;
}

export interface PersonalNote {
  id: string;
  userId: string;
  ownerRole: UserRole;
  title: string;
  content: string;
  category: string;
  scriptureRef?: string;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
}

