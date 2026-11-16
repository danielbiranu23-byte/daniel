import {
  BookOpen,
  Check,
  Copy,
  Loader2,
  MessageSquare,
  PanelLeft,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { sendChatMessageSeamless } from '../lib/offlineChat';
import type {
  BibleReferenceTarget,
  ChatMessage,
  ChatThread,
  PublicAdminSettings,
  StudyDocument,
} from '../types';
import { ChatbotMessageContent } from './ChatbotMessageContent';

interface ChatWorkspaceProps {
  settings: PublicAdminSettings;
  documents: StudyDocument[];
  chats: ChatThread[];
  activeThreadId: string | null;
  focusDocId: string | 'all';
  onSelectThread: (threadId: string | null) => void;
  onChangeFocusDoc: (docId: string | 'all') => void;
  onCreateNewChat: (focusDocId?: string | 'all') => Promise<void>;
  onDeleteThread: (threadId: string) => Promise<void>;
  onThreadsUpdated: () => Promise<void>;
  onReadLesson: (doc: StudyDocument) => void;
  onOpenBibleRef: (target: BibleReferenceTarget) => void;
}

const STARTER_PROMPTS = [
  'Boqonnaa 1ffaa irraa jalqabii tartiibaan Barnoota Macaafa Qulqulluu na barsiisi.',
  'Kakuu Moofaa fi Kakuu Haaraa gidduu walitti dhufeenyi jiru maali?',
  'Waa’ee fayyinaa fi ayyaana Waaqayyoo luqqisiiwwan waliin naaf ibsi.',
  'Akkaataan kadhannaa Yesus barsiise (Maatewos 6) maalfaa of keessaa qaba?',
];

export function ChatWorkspace({
  settings,
  documents,
  chats,
  activeThreadId,
  focusDocId,
  onSelectThread,
  onChangeFocusDoc,
  onCreateNewChat,
  onDeleteThread,
  onThreadsUpdated,
  onReadLesson,
  onOpenBibleRef,
}: ChatWorkspaceProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [scopeTestament, setScopeTestament] = useState<'all' | 'old' | 'new'>('all');
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [optimisticUserMsg, setOptimisticUserMsg] = useState<ChatMessage | null>(null);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredScopeDocs = documents.filter((d) => {
    if (scopeTestament === 'all') return true;
    const hay = `${d.title} ${d.category} ${d.summary}`.toLowerCase();
    return scopeTestament === 'old' ? hay.includes('kakuu moofaa') : hay.includes('kakuu haaraa');
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeThread = chats.find((c) => c.id === activeThreadId) || null;
  const displayedMessages = activeThread ? activeThread.messages : [];
  const effectiveFocusDocId = activeThread ? activeThread.focusDocId : focusDocId;
  const focusedDoc =
    effectiveFocusDocId !== 'all' ? documents.find((d) => d.id === effectiveFocusDocId) : null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayedMessages.length, streamingText, optimisticUserMsg]);

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const sendMessage = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || streaming) return;

    setError('');
    setInput('');
    setStreaming(true);
    setStreamingText('');

    const tempUser: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setOptimisticUserMsg(tempUser);

    try {
      await sendChatMessageSeamless({
        threadId: activeThreadId,
        message: trimmed,
        focusDocId: effectiveFocusDocId,
        documents,
        chats,
        onChunk: (text) => setStreamingText(text),
        onComplete: async (resolvedId) => {
          await onThreadsUpdated();
          if (resolvedId) {
            onSelectThread(resolvedId);
          }
        },
      });
    } finally {
      setStreaming(false);
      setStreamingText('');
      setOptimisticUserMsg(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 animate-enter">
      <div className="sanctuary-card rounded-2xl overflow-hidden flex h-[calc(100vh-8.5rem)] min-h-[540px]">
        {/* Left Sidebar (Chat History + Source Focus) */}
        {sidebarOpen && (
          <aside className="w-72 border-r border-[#e4e0d8] bg-[#f7f6f2] flex flex-col shrink-0">
            <div className="p-3.5 border-b border-[#e4e0d8]">
              <button
                type="button"
                onClick={() => onCreateNewChat(focusDocId)}
                className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 text-sm font-medium text-white bg-[#142d4c] rounded-lg hover:bg-[#0e2139] shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4 text-[#f5d08a]" />
                <span>Marii Haaraa</span>
              </button>
            </div>

            {/* Study File Context Selector */}
            <div className="p-3.5 border-b border-[#e4e0d8] space-y-2.5">
              <div className="grid grid-cols-3 gap-1 p-0.5 bg-[#e9e5dc] rounded-lg">
                {(
                  [
                    { id: 'all', label: 'Hundaa' },
                    { id: 'old', label: 'Kakuu Moofaa' },
                    { id: 'new', label: 'Kakuu Haaraa' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setScopeTestament(t.id)}
                    className={`py-1 px-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      scopeTestament === t.id
                        ? 'bg-white text-[#142d4c] shadow-xs'
                        : 'text-[#52504b] hover:text-[#171614]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <label
                htmlFor="chat-source-select"
                className="block text-xs font-medium text-[#52504b]"
              >
                Madda Barnootaa (Study Scope)
              </label>
              <select
                id="chat-source-select"
                value={effectiveFocusDocId}
                onChange={(e) => onChangeFocusDoc(e.target.value)}
                disabled={streaming}
                className="w-full px-2.5 py-2 text-xs bg-white border border-[#e4e0d8] rounded-lg text-[#171614] focus:outline-none focus:ring-2 focus:ring-[#142d4c]"
              >
                <option value="all">
                  Macaafa Qulqulluu &amp; Barnoota Hunda ({filteredScopeDocs.length})
                </option>
                {filteredScopeDocs.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {String(doc.order).padStart(2, '0')}. {doc.title}
                  </option>
                ))}
              </select>

              {focusedDoc && (
                <button
                  type="button"
                  onClick={() => onReadLesson(focusedDoc)}
                  className="w-full text-left text-xs text-[#142d4c] hover:underline flex items-center gap-1.5 pt-0.5 cursor-pointer"
                >
                  <BookOpen className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Barnoota kana dubbisi</span>
                </button>
              )}
            </div>

            {/* Saved Threads */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-1">
              <p className="px-2 py-1 text-[11px] uppercase tracking-[0.1em] font-semibold text-[#76736c]">
                Seenaa Marii
              </p>
              {chats.length === 0 ? (
                <p className="px-2 py-4 text-xs text-[#76736c]">
                  Mariin jalqabame hin jiru. Gaaffii gaafachuun jalqabi.
                </p>
              ) : (
                chats.map((thread) => {
                  const isActive = thread.id === activeThreadId;
                  return (
                    <div
                      key={thread.id}
                      className={`group flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors ${
                        isActive
                          ? 'bg-white border border-[#e4e0d8] text-[#142d4c] font-semibold shadow-2xs'
                          : 'text-[#52504b] hover:bg-[#efeae1] hover:text-[#171614]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectThread(thread.id)}
                        className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5 shrink-0 text-[#9a6b16]" />
                        <span className="truncate">{thread.title}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteThread(thread.id)}
                        aria-label="Delete conversation"
                        className="opacity-0 group-hover:opacity-100 p-1 text-[#76736c] hover:text-red-600 transition-opacity cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        )}

        {/* Main Chat Viewport */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          {/* Top toolbar */}
          <div className="px-5 py-3.5 border-b border-[#e4e0d8] flex items-center justify-between gap-4 bg-white">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setSidebarOpen((prev) => !prev)}
                aria-label="Toggle chat sidebar"
                className="p-1.5 text-[#52504b] hover:text-[#171614] rounded-lg hover:bg-[#f7f6f2] cursor-pointer"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#171614] truncate">
                  {activeThread ? activeThread.title : settings.tutorName}
                </p>
                <p className="text-xs text-[#76736c] truncate">
                  {focusedDoc
                    ? `Xiyyeeffannoo: ${focusedDoc.title}`
                    : `Madda: Macaafa Qulqulluu & Barnoota (${documents.length})`}
                </p>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-6">
            {displayedMessages.length === 0 && !optimisticUserMsg && (
              <div className="max-w-2xl mx-auto py-8 space-y-8">
                <div className="space-y-3 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-[#142d4c] text-[#f5d08a] flex items-center justify-center mx-auto shadow-xs">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <h2 className="font-editorial text-2xl font-semibold text-[#171614]">
                    {settings.tutorName}
                  </h2>
                  <p className="text-sm text-[#52504b] leading-relaxed max-w-lg mx-auto">
                    {settings.welcomeGreeting}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {STARTER_PROMPTS.map((prompt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => sendMessage(prompt)}
                      className="text-left p-4 rounded-xl border border-[#e4e0d8] bg-[#f7f6f2] hover:border-[#142d4c]/40 hover:bg-white hover:shadow-xs transition-all text-xs sm:text-sm text-[#171614] leading-relaxed cursor-pointer"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="max-w-3xl mx-auto space-y-6">
              {displayedMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'user' ? (
                    <div className="max-w-[85%] bg-[#142d4c] text-white px-4 py-3 rounded-2xl rounded-br-sm text-sm leading-relaxed whitespace-pre-wrap shadow-xs">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="w-full space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs text-[#76736c]">
                        <span className="font-semibold text-[#142d4c]">{settings.tutorName}</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(msg.id, msg.content)}
                          className="inline-flex items-center gap-1 text-[#76736c] hover:text-[#171614] cursor-pointer"
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="text-emerald-700">Garagalfame</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>

                      <div className="bg-[#f7f6f2] border border-[#e4e0d8] rounded-2xl px-5 py-4 prose prose-sm prose-zinc max-w-none prose-headings:font-editorial prose-headings:text-[#171614] prose-p:leading-relaxed prose-blockquote:bg-white prose-blockquote:border prose-blockquote:border-[#e4e0d8] prose-blockquote:rounded-xl prose-blockquote:py-2 prose-blockquote:px-3.5 prose-blockquote:not-italic">
                        <ChatbotMessageContent
                          content={msg.content}
                          onOpenBibleRef={onOpenBibleRef}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Optimistic user message while streaming */}
              {optimisticUserMsg &&
                !displayedMessages.some(
                  (m) => m.content === optimisticUserMsg.content && m.id === optimisticUserMsg.id
                ) && (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] bg-[#142d4c] text-white px-4 py-3 rounded-2xl rounded-br-sm text-sm leading-relaxed whitespace-pre-wrap shadow-xs">
                      {optimisticUserMsg.content}
                    </div>
                  </div>
                )}

              {/* Live streaming assistant bubble */}
              {streaming && (
                <div className="w-full space-y-2">
                  <div className="flex items-center gap-2 text-xs text-[#76736c]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#142d4c]" />
                    <span className="font-medium text-[#142d4c]">{settings.tutorName} barreessaa jira...</span>
                  </div>
                  <div className="bg-[#f7f6f2] border border-[#e4e0d8] rounded-2xl px-5 py-4 prose prose-sm prose-zinc max-w-none">
                    {streamingText ? (
                      <ChatbotMessageContent
                        content={streamingText}
                        onOpenBibleRef={onOpenBibleRef}
                      />
                    ) : (
                      <p className="text-[#76736c] text-sm">Faayiloota barnootaa sakatta’aa jira...</p>
                    )}
                  </div>
                </div>
              )}

              {error && (
                <div className="w-full space-y-2">
                  <div className="bg-[#f7f6f2] border border-[#e4e0d8] rounded-2xl px-5 py-4 text-sm text-[#171614] leading-relaxed">
                    {error}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Composer */}
          <div className="p-4 border-t border-[#e4e0d8] bg-[#f7f6f2]">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage(input);
              }}
              className="max-w-3xl mx-auto"
            >
              <div className="flex items-end gap-2 bg-white border border-[#e4e0d8] rounded-xl p-2 shadow-2xs focus-within:ring-2 focus-within:ring-[#142d4c] focus-within:border-[#142d4c]">
                <textarea
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Waa’ee Barnoota Macaafa Qulqulluu gaaffii kee asitti barreessi..."
                  disabled={streaming}
                  className="flex-1 resize-none bg-transparent px-2.5 py-2 text-sm text-[#171614] placeholder:text-[#76736c] focus:outline-none max-h-36"
                />
                <button
                  type="submit"
                  disabled={streaming || !input.trim()}
                  aria-label="Send message"
                  className="p-2.5 rounded-lg bg-[#142d4c] text-white hover:bg-[#0e2139] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0 cursor-pointer"
                >
                  {streaming ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
              <p className="text-[11px] text-[#76736c] mt-2 text-center">
                Enter tuquun ergi · Shift + Enter sarara haaraaf · Macaafa Qulqulluu fi barnoota ({documents.length}) irratti hundaa’a.
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
