import type {
  AuthUser,
  BibleBookCatalogItem,
  BibleHighlight,
  ChatThread,
  PublicAdminSettings,
  StudentProgress,
  StudyDocument,
} from '../types';

export interface OfflineBibleBook {
  id: string;
  order: number;
  omName: string;
  enName: string;
  testament: 'old' | 'new';
  chapters: Array<{
    n: number;
    v: Array<[number, string, string]>;
  }>;
}

export interface OfflineBibleBundle {
  books: OfflineBibleBook[];
}

export interface OfflineCurriculumSnapshot {
  settings: PublicAdminSettings;
  documents: StudyDocument[];
  progress: StudentProgress;
}

const DB_NAME = 'qajeelcha_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function cacheAuthUser(user: AuthUser | null): Promise<void> {
  await idbSet('auth_user', user);
}

export async function getCachedAuthUser(): Promise<AuthUser | null> {
  return idbGet<AuthUser>('auth_user');
}

export async function cacheCurriculum(snapshot: OfflineCurriculumSnapshot): Promise<void> {
  await idbSet('curriculum', snapshot);
}

export async function getCachedCurriculum(): Promise<OfflineCurriculumSnapshot | null> {
  return idbGet<OfflineCurriculumSnapshot>('curriculum');
}

export async function cacheChats(chats: ChatThread[]): Promise<void> {
  await idbSet('chats', chats);
}

export async function getCachedChats(): Promise<ChatThread[]> {
  return (await idbGet<ChatThread[]>('chats')) || [];
}

export async function cacheBibleBundle(bundle: OfflineBibleBundle): Promise<void> {
  await idbSet('bible_bundle', bundle);
}

export async function getCachedBibleBundle(): Promise<OfflineBibleBundle | null> {
  return idbGet<OfflineBibleBundle>('bible_bundle');
}

export async function cacheBibleHighlights(
  userId: string,
  highlights: BibleHighlight[]
): Promise<void> {
  await idbSet(`bible_highlights_${userId}`, highlights);
}

export async function getCachedBibleHighlights(userId: string): Promise<BibleHighlight[]> {
  return (await idbGet<BibleHighlight[]>(`bible_highlights_${userId}`)) || [];
}

export function bundleToCatalog(bundle: OfflineBibleBundle): BibleBookCatalogItem[] {
  return bundle.books.map((b) => ({
    id: b.id,
    order: b.order,
    omName: b.omName,
    omTitle: b.omName,
    enName: b.enName,
    chapters: b.chapters.length,
    verses: b.chapters.reduce((sum, ch) => sum + ch.v.length, 0),
    testament: b.testament,
    imported: false,
  }));
}
