import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  BibleHighlight,
  ChatMessage,
  ChatThread,
  PersonalNote,
  PublicAdminSettings,
  StudentProgress,
  StudyDocument,
} from '../types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const BOOTSTRAPPED_ADMIN_EMAIL = 'danielbiranu.23@gmail.com';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

function clampStr(val: string | undefined, maxLen: number, fallback = ''): string {
  const s = (val ?? fallback).trim();
  if (!s) return fallback.slice(0, maxLen);
  return s.slice(0, maxLen);
}

function sanitizeId(raw: string, allowColon = false): string {
  const pattern = allowColon ? /[^a-zA-Z0-9_\-:]/g : /[^a-zA-Z0-9_\-]/g;
  const cleaned = raw.replace(pattern, '_').slice(0, 128);
  return cleaned || `id_${Date.now()}`;
}

export async function signInWithGooglePopup(): Promise<{ user: User; idToken: string }> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  const idToken = await cred.user.getIdToken();
  return { user: cred.user, idToken };
}

export async function signOutFirebase(): Promise<void> {
  try {
    await signOut(auth);
  } catch {
    // ignore signOut errors
  }
}

export async function verifyConnectionWithAuth(): Promise<void> {
  if (!auth.currentUser) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

export async function ensureFirebaseProfile(
  fbUser: User
): Promise<{ role: 'admin' | 'user' }> {
  if (!fbUser.emailVerified) {
    throw new Error('Google email mirkanaa’uu qaba (email verification required).');
  }

  const uid = sanitizeId(fbUser.uid);
  const isBootstrapped =
    (fbUser.email || '').toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();
  const now = new Date().toISOString();

  if (isBootstrapped) {
    const adminPath = `admins/${uid}`;
    try {
      const adminSnap = await getDoc(doc(db, 'admins', uid));
      if (!adminSnap.exists()) {
        await setDoc(doc(db, 'admins', uid), { uid, createdAt: now });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, adminPath);
    }
  }

  let isFirestoreAdmin = isBootstrapped;
  if (!isFirestoreAdmin) {
    try {
      const adminSnap = await getDoc(doc(db, 'admins', uid));
      if (adminSnap.exists()) isFirestoreAdmin = true;
    } catch {
      isFirestoreAdmin = false;
    }
  }

  const userPath = `users/${uid}`;
  try {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    const displayName = clampStr(
      fbUser.displayName || fbUser.email?.split('@')[0] || 'Fayyadamaa',
      120,
      'Fayyadamaa'
    );
    const username = clampStr(
      (fbUser.email || fbUser.uid).split('@')[0],
      80,
      uid
    );

    if (!snap.exists()) {
      const role: 'admin' | 'user' = isFirestoreAdmin ? 'admin' : 'user';
      await setDoc(userRef, {
        uid,
        displayName,
        username,
        role,
        createdAt: now,
        updatedAt: now,
      });
      return { role };
    }

    const existing = snap.data() as { role?: 'admin' | 'user' };
    await updateDoc(userRef, {
      displayName,
      username,
      updatedAt: now,
    });
    return {
      role: isFirestoreAdmin || existing.role === 'admin' ? 'admin' : 'user',
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function fetchSettingsFromFirestore(): Promise<PublicAdminSettings | null> {
  if (!auth.currentUser?.emailVerified) return null;
  const path = 'appSettings/global';
  try {
    const snap = await getDoc(doc(db, 'appSettings', 'global'));
    if (!snap.exists()) return null;
    const d = snap.data() as Record<string, unknown>;
    return {
      tutorName: typeof d.tutorName === 'string' ? d.tutorName : 'Barsiisaa Macaafaa AI',
      welcomeGreeting: typeof d.welcomeGreeting === 'string' ? d.welcomeGreeting : '',
      systemInstructions: typeof d.systemInstructions === 'string' ? d.systemInstructions : '',
      instructionFileName:
        typeof d.instructionFileName === 'string' ? d.instructionFileName : '',
      languageMode:
        d.languageMode === 'en' || d.languageMode === 'bilingual' ? d.languageMode : 'om',
      groundingMode: d.groundingMode === 'files_plus_bible' ? 'files_plus_bible' : 'strict_files',
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveSettingsToFirestore(
  uid: string,
  settings: PublicAdminSettings
): Promise<void> {
  if (!auth.currentUser?.emailVerified) return;
  const path = 'appSettings/global';
  const payload: Record<string, string> = {
    tutorName: clampStr(settings.tutorName, 120, 'Barsiisaa Macaafaa AI'),
    welcomeGreeting: clampStr(settings.welcomeGreeting, 2000, 'Akkam jirtu!'),
    languageMode:
      settings.languageMode === 'en' || settings.languageMode === 'bilingual'
        ? settings.languageMode
        : 'om',
    groundingMode:
      settings.groundingMode === 'files_plus_bible' ? 'files_plus_bible' : 'strict_files',
    updatedBy: clampStr(uid, 128, auth.currentUser.uid),
    updatedAt: new Date().toISOString(),
  };
  if (settings.systemInstructions?.trim()) {
    payload.systemInstructions = clampStr(settings.systemInstructions, 8000);
  }
  if (settings.instructionFileName?.trim()) {
    payload.instructionFileName = clampStr(settings.instructionFileName, 200);
  }

  try {
    await setDoc(doc(db, 'appSettings', 'global'), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchStudyDocsFromFirestore(
  isAdmin: boolean
): Promise<StudyDocument[]> {
  if (!auth.currentUser?.emailVerified) return [];
  const path = 'studyDocuments';
  try {
    const colRef = collection(db, 'studyDocuments');
    const q = isAdmin ? colRef : query(colRef, where('active', '==', true));
    const snap = await getDocs(q);
    const docs: StudyDocument[] = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data() as Record<string, unknown>;
      docs.push({
        id: String(d.id || docSnap.id),
        order: typeof d.order === 'number' ? d.order : 0,
        title: String(d.title || ''),
        category: String(d.category || 'Barnoota'),
        fileName: String(d.fileName || ''),
        mimeType: String(d.mimeType || 'text/markdown'),
        sizeBytes: typeof d.sizeBytes === 'number' ? d.sizeBytes : 0,
        sourceType:
          d.sourceType === 'upload' || d.sourceType === 'lesson' ? d.sourceType : 'starter',
        active: Boolean(d.active),
        summary: String(d.summary || ''),
        textContent: String(d.textContent || ''),
        createdAt: String(d.createdAt || new Date().toISOString()),
        updatedAt: String(d.updatedAt || new Date().toISOString()),
      });
    });
    docs.sort((a, b) => a.order - b.order);
    return docs;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveStudyDocToFirestore(
  uid: string,
  studyDoc: StudyDocument
): Promise<void> {
  if (!auth.currentUser?.emailVerified) return;
  const docId = sanitizeId(studyDoc.id);
  const path = `studyDocuments/${docId}`;
  const now = new Date().toISOString();
  const order = Math.max(0, Math.min(10000, Math.round(studyDoc.order || 0)));
  const title = clampStr(studyDoc.title, 300, 'Barnoota');
  const category = clampStr(studyDoc.category, 120, 'Barnoota');
  const fileName = clampStr(studyDoc.fileName, 255, `${docId}.md`);
  const mimeType = clampStr(studyDoc.mimeType, 120, 'text/markdown');
  const sizeBytes = Math.max(0, Math.min(50000000, Math.round(studyDoc.sizeBytes || 0)));
  const sourceType =
    studyDoc.sourceType === 'upload' || studyDoc.sourceType === 'lesson'
      ? studyDoc.sourceType
      : 'starter';
  const summary = clampStr(studyDoc.summary, 1000, title);
  const textContent = (studyDoc.textContent || '').slice(0, 450000);

  try {
    const ref = doc(db, 'studyDocuments', docId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        order,
        title,
        category,
        fileName,
        mimeType,
        sizeBytes,
        sourceType,
        active: Boolean(studyDoc.active),
        summary,
        textContent,
        updatedAt: now,
      });
    } else {
      await setDoc(ref, {
        id: docId,
        order,
        title,
        category,
        fileName,
        mimeType,
        sizeBytes,
        sourceType,
        active: Boolean(studyDoc.active),
        summary,
        textContent,
        authorId: clampStr(uid, 128, auth.currentUser.uid),
        createdAt: clampStr(studyDoc.createdAt, 40, now),
        updatedAt: now,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteStudyDocFromFirestore(docId: string): Promise<void> {
  if (!auth.currentUser?.emailVerified) return;
  const safeId = sanitizeId(docId);
  const path = `studyDocuments/${safeId}`;
  try {
    await deleteDoc(doc(db, 'studyDocuments', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function fetchProgressFromFirestore(uid: string): Promise<StudentProgress> {
  if (!auth.currentUser?.emailVerified) {
    return { completedDocIds: [], quizScores: {} };
  }
  const safeUid = sanitizeId(uid);
  const path = `users/${safeUid}/progress`;
  try {
    const q = query(
      collection(db, 'users', safeUid, 'progress'),
      where('userId', '==', safeUid)
    );
    const snap = await getDocs(q);
    const completedDocIds: string[] = [];
    const quizScores: StudentProgress['quizScores'] = {};
    snap.forEach((docSnap) => {
      const d = docSnap.data() as {
        docId?: string;
        completed?: boolean;
        quizScore?: number;
        quizTotal?: number;
        updatedAt?: string;
      };
      const id = d.docId || docSnap.id;
      if (d.completed) completedDocIds.push(id);
      if (typeof d.quizScore === 'number' && typeof d.quizTotal === 'number') {
        quizScores[id] = {
          score: d.quizScore,
          total: d.quizTotal,
          completedAt: d.updatedAt || new Date().toISOString(),
        };
      }
    });
    return { completedDocIds, quizScores };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveProgressToFirestore(
  uid: string,
  docId: string,
  update: { completed?: boolean; quizScore?: number; quizTotal?: number }
): Promise<void> {
  if (!auth.currentUser?.emailVerified) return;
  const safeUid = sanitizeId(uid);
  const safeDocId = sanitizeId(docId);
  const path = `users/${safeUid}/progress/${safeDocId}`;
  const now = new Date().toISOString();
  try {
    const ref = doc(db, 'users', safeUid, 'progress', safeDocId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const payload: Record<string, unknown> = { updatedAt: now };
      if (typeof update.completed === 'boolean') payload.completed = update.completed;
      if (typeof update.quizScore === 'number') {
        payload.quizScore = Math.max(0, Math.min(1000, Math.round(update.quizScore)));
      }
      if (typeof update.quizTotal === 'number') {
        payload.quizTotal = Math.max(0, Math.min(1000, Math.round(update.quizTotal)));
      }
      await updateDoc(ref, payload);
    } else {
      const payload: Record<string, unknown> = {
        docId: safeDocId,
        userId: safeUid,
        completed: Boolean(update.completed),
        updatedAt: now,
      };
      if (typeof update.quizScore === 'number') {
        payload.quizScore = Math.max(0, Math.min(1000, Math.round(update.quizScore)));
      }
      if (typeof update.quizTotal === 'number') {
        payload.quizTotal = Math.max(0, Math.min(1000, Math.round(update.quizTotal)));
      }
      await setDoc(ref, payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchHighlightsFromFirestore(uid: string): Promise<BibleHighlight[]> {
  if (!auth.currentUser?.emailVerified) return [];
  const safeUid = sanitizeId(uid);
  const path = `users/${safeUid}/highlights`;
  try {
    const q = query(
      collection(db, 'users', safeUid, 'highlights'),
      where('userId', '==', safeUid)
    );
    const snap = await getDocs(q);
    const list: BibleHighlight[] = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data() as Record<string, unknown>;
      const color =
        d.color === 'blue' || d.color === 'green' || d.color === 'rose' ? d.color : 'yellow';
      list.push({
        id: String(d.id || docSnap.id),
        bookId: String(d.bookId || ''),
        omName: String(d.omName || ''),
        enName: String(d.enName || ''),
        chapter: Number(d.chapter || 1),
        verse: Number(d.verse || 1),
        omText: String(d.omText || ''),
        enText: String(d.enText || ''),
        color,
        savedAt: String(d.savedAt || new Date().toISOString()),
      });
    });
    list.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveHighlightToFirestore(
  uid: string,
  highlight: BibleHighlight
): Promise<void> {
  if (!auth.currentUser?.emailVerified) return;
  const safeUid = sanitizeId(uid);
  const safeId = sanitizeId(highlight.id, true).slice(0, 64);
  const path = `users/${safeUid}/highlights/${safeId}`;
  const color =
    highlight.color === 'blue' || highlight.color === 'green' || highlight.color === 'rose'
      ? highlight.color
      : 'yellow';
  const savedAt = clampStr(highlight.savedAt, 40, new Date().toISOString());
  const omText = (highlight.omText || '').slice(0, 4000);
  const enText = (highlight.enText || '').slice(0, 4000);

  try {
    const ref = doc(db, 'users', safeUid, 'highlights', safeId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, { color, savedAt, omText, enText });
    } else {
      await setDoc(ref, {
        id: safeId,
        userId: safeUid,
        bookId: clampStr(highlight.bookId, 16, 'JHN'),
        omName: clampStr(highlight.omName, 80, highlight.bookId),
        enName: clampStr(highlight.enName, 80, highlight.bookId),
        chapter: Math.max(1, Math.min(200, Math.round(highlight.chapter))),
        verse: Math.max(1, Math.min(300, Math.round(highlight.verse))),
        omText,
        enText,
        color,
        savedAt,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteHighlightFromFirestore(
  uid: string,
  highlightId: string
): Promise<void> {
  if (!auth.currentUser?.emailVerified) return;
  const safeUid = sanitizeId(uid);
  const safeId = sanitizeId(highlightId, true).slice(0, 64);
  const path = `users/${safeUid}/highlights/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', safeUid, 'highlights', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function fetchChatThreadsFromFirestore(uid: string): Promise<ChatThread[]> {
  if (!auth.currentUser?.emailVerified) return [];
  const safeUid = sanitizeId(uid);
  const path = `users/${safeUid}/chats`;
  try {
    const q = query(collection(db, 'users', safeUid, 'chats'), where('userId', '==', safeUid));
    const snap = await getDocs(q);
    const threads: ChatThread[] = [];
    for (const threadDoc of snap.docs) {
      const td = threadDoc.data() as Record<string, unknown>;
      const threadId = String(td.id || threadDoc.id);
      const msgsPath = `users/${safeUid}/chats/${threadId}/messages`;
      let messages: ChatMessage[] = [];
      try {
        const mq = query(
          collection(db, 'users', safeUid, 'chats', threadId, 'messages'),
          where('userId', '==', safeUid)
        );
        const mSnap = await getDocs(mq);
        messages = mSnap.docs
          .map((m) => {
            const md = m.data() as Record<string, unknown>;
            return {
              id: String(md.id || m.id),
              role: (md.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
              content: String(md.content || ''),
              createdAt: String(md.createdAt || new Date().toISOString()),
            };
          })
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      } catch (mErr) {
        handleFirestoreError(mErr, OperationType.LIST, msgsPath);
      }
      threads.push({
        id: threadId,
        userId: safeUid,
        title: String(td.title || 'Marii Haaraa'),
        focusDocId: String(td.focusDocId || 'all'),
        messages,
        createdAt: String(td.createdAt || new Date().toISOString()),
        updatedAt: String(td.updatedAt || new Date().toISOString()),
      });
    }
    threads.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return threads;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveChatThreadWithMessagesToFirestore(
  uid: string,
  thread: ChatThread
): Promise<void> {
  if (!auth.currentUser?.emailVerified) return;
  const safeUid = sanitizeId(uid);
  const safeThreadId = sanitizeId(thread.id);
  const threadPath = `users/${safeUid}/chats/${safeThreadId}`;
  const now = new Date().toISOString();
  const title = clampStr(thread.title, 200, 'Marii Haaraa');
  const focusDocId = clampStr(thread.focusDocId, 128, 'all');

  try {
    const threadRef = doc(db, 'users', safeUid, 'chats', safeThreadId);
    const threadSnap = await getDoc(threadRef);
    if (threadSnap.exists()) {
      await updateDoc(threadRef, {
        title,
        focusDocId,
        updatedAt: clampStr(thread.updatedAt, 40, now),
      });
    } else {
      await setDoc(threadRef, {
        id: safeThreadId,
        userId: safeUid,
        title,
        focusDocId,
        createdAt: clampStr(thread.createdAt, 40, now),
        updatedAt: clampStr(thread.updatedAt, 40, now),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, threadPath);
  }

  // Messages are immutable (allow update: if false), so write only unseen messages
  const msgsColPath = `users/${safeUid}/chats/${safeThreadId}/messages`;
  let existingMsgIds = new Set<string>();
  try {
    const mq = query(
      collection(db, 'users', safeUid, 'chats', safeThreadId, 'messages'),
      where('userId', '==', safeUid)
    );
    const mSnap = await getDocs(mq);
    existingMsgIds = new Set(mSnap.docs.map((d) => d.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, msgsColPath);
  }

  for (const msg of thread.messages) {
    const safeMsgId = sanitizeId(msg.id);
    if (existingMsgIds.has(safeMsgId)) continue;
    const msgPath = `${msgsColPath}/${safeMsgId}`;
    try {
      await setDoc(doc(db, 'users', safeUid, 'chats', safeThreadId, 'messages', safeMsgId), {
        id: safeMsgId,
        userId: safeUid,
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: clampStr(msg.content, 40000, '...'),
        createdAt: clampStr(msg.createdAt, 40, now),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, msgPath);
    }
  }
}

export async function deleteChatThreadFromFirestore(
  uid: string,
  threadId: string
): Promise<void> {
  if (!auth.currentUser?.emailVerified) return;
  const safeUid = sanitizeId(uid);
  const safeThreadId = sanitizeId(threadId);
  const msgsPath = `users/${safeUid}/chats/${safeThreadId}/messages`;
  try {
    const mq = query(
      collection(db, 'users', safeUid, 'chats', safeThreadId, 'messages'),
      where('userId', '==', safeUid)
    );
    const mSnap = await getDocs(mq);
    for (const mDoc of mSnap.docs) {
      await deleteDoc(doc(db, 'users', safeUid, 'chats', safeThreadId, 'messages', mDoc.id));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, msgsPath);
  }

  const threadPath = `users/${safeUid}/chats/${safeThreadId}`;
  try {
    await deleteDoc(doc(db, 'users', safeUid, 'chats', safeThreadId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, threadPath);
  }
}

export async function fetchNotesFromFirestore(uid: string): Promise<PersonalNote[]> {
  if (!auth.currentUser?.emailVerified) return [];
  const safeUid = sanitizeId(uid);
  const path = `users/${safeUid}/notes`;
  try {
    const q = query(collection(db, 'users', safeUid, 'notes'), where('userId', '==', safeUid));
    const snap = await getDocs(q);
    const items: PersonalNote[] = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data() as Record<string, unknown>;
      items.push({
        id: String(d.id || docSnap.id),
        userId: String(d.userId || safeUid),
        ownerRole: d.ownerRole === 'admin' ? 'admin' : 'user',
        title: String(d.title || 'Yaadannoo'),
        content: String(d.content || ''),
        category: String(d.category || 'Yaadannoo'),
        scriptureRef: typeof d.scriptureRef === 'string' ? d.scriptureRef : undefined,
        pinned: Boolean(d.pinned),
        createdAt: String(d.createdAt || new Date().toISOString()),
        updatedAt: String(d.updatedAt || new Date().toISOString()),
      });
    });
    items.sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    return items;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveNoteToFirestore(uid: string, note: PersonalNote): Promise<void> {
  if (!auth.currentUser?.emailVerified) return;
  const safeUid = sanitizeId(uid);
  const safeNoteId = sanitizeId(note.id);
  const path = `users/${safeUid}/notes/${safeNoteId}`;
  const now = new Date().toISOString();
  const title = clampStr(note.title, 200, 'Yaadannoo');
  const content = clampStr(note.content, 20000, '...');
  const category = clampStr(note.category, 80, 'Yaadannoo');
  const scriptureRef = clampStr(note.scriptureRef, 120, '');
  const updatedAt = clampStr(note.updatedAt, 40, now);

  try {
    const noteRef = doc(db, 'users', safeUid, 'notes', safeNoteId);
    const existingSnap = await getDoc(noteRef);
    if (existingSnap.exists()) {
      await updateDoc(noteRef, {
        title,
        content,
        category,
        ...(scriptureRef ? { scriptureRef } : {}),
        pinned: Boolean(note.pinned),
        updatedAt,
      });
    } else {
      await setDoc(noteRef, {
        id: safeNoteId,
        userId: safeUid,
        ownerRole: note.ownerRole === 'admin' ? 'admin' : 'user',
        title,
        content,
        category,
        ...(scriptureRef ? { scriptureRef } : {}),
        pinned: Boolean(note.pinned),
        createdAt: clampStr(note.createdAt, 40, now),
        updatedAt,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteNoteFromFirestore(uid: string, noteId: string): Promise<void> {
  if (!auth.currentUser?.emailVerified) return;
  const safeUid = sanitizeId(uid);
  const safeNoteId = sanitizeId(noteId);
  const path = `users/${safeUid}/notes/${safeNoteId}`;
  try {
    await deleteDoc(doc(db, 'users', safeUid, 'notes', safeNoteId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
