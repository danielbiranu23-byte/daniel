import {
  BookOpen,
  Check,
  Copy,
  Loader2,
  Maximize2,
  MessageSquare,
  Plus,
  Send,
  X,
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

interface FloatingChatbotWidgetProps {
  settings: PublicAdminSettings;
  documents: StudyDocument[];
  chats: ChatThread[];
  activeThreadId: string | null;
  focusDocId: string | 'all';
  onSelectThread: (threadId: string | null) => void;
  onChangeFocusDoc: (docId: string | 'all') => void;
  onThreadsUpdated: () => Promise<void>;
  onExpandFullChat: () => void;
  onOpenBibleRef: (target: BibleReferenceTarget) => void;
}

const QUICK_PROMPTS = [
  'Boqonnaa 1ffaa keessatti kitaabonni Kakuu Moofaa meeqa?',
  'Wangeelli arfan maal irratti xiyyeeffatu?',
  'Fayyinni akkamitti akka argamu faayila irraa naaf ibsi.',
];

export function FloatingChatbotWidget({
  settings,
  documents,
  chats,
  activeThreadId,
  focusDocId,
  onSelectThread,
  onChangeFocusDoc,
  onThreadsUpdated,
  onExpandFullChat,
  onOpenBibleRef,
}: FloatingChatbotWidgetProps) {
  const [open, setOpen] = useState(false);
  const [scopeTestament, setScopeTestament] = useState<'all' | 'old' | 'new'>('all');
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [optimisticUserMsg, setOptimisticUserMsg] = useState<ChatMessage | null>(null);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeThread = chats.find((c) => c.id === activeThreadId) || null;
  const displayedMessages = activeThread ? activeThread.messages : [];
  const effectiveFocusDocId = activeThread ? activeThread.focusDocId : focusDocId;
  const filteredScopeDocs = documents.filter((d) => {
    if (scopeTestament === 'all') return true;
    const hay = `${d.title} ${d.category} ${d.summary}`.toLowerCase();
    return scopeTestament === 'old' ? hay.includes('kakuu moofaa') : hay.includes('kakuu haaraa');
  });

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [open, displayedMessages.length, streamingText, optimisticUserMsg]);

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1600);
    } catch {
      // ignore
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

  if (!open) {
    return (
      <div className="fixed bottom-5 right-5 z-[60]">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Chatbot bani"
          className="inline-flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-white bg-[#142d4c] rounded-xl shadow-lg hover:bg-[#0e2139] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#142d4c]"
        >
          <MessageSquare className="w-4 h-4 text-[#f5d08a]" aria-hidden="true" />
          <span>Chatbot Gaafadhu</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] sm:w-[440px] h-[580px] max-h-[82vh] bg-white border border-[#e4e0d8] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-enter"
      role="dialog"
      aria-label={settings.tutorName}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#e4e0d8] bg-[#142d4c] text-white flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <BookOpen className="w-4 h-4 text-[#f5d08a] shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{settings.tutorName}</p>
            <p className="text-[11px] text-zinc-200/90 truncate">
              Faayiloota kennaman ({documents.length}) irratti xiyyeeffata
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              onSelectThread(null);
              setError('');
            }}
            title="Marii Haaraa"
            aria-label="Marii Haaraa"
            className="p-1.5 text-zinc-200 hover:text-white hover:bg-white/10 rounded-md cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onExpandFullChat();
            }}
            title="Fuula Guutuutti Bani"
            aria-label="Expand chatbot to full page"
            className="p-1.5 text-zinc-200 hover:text-white hover:bg-white/10 rounded-md cursor-pointer"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            title="Cufi"
            aria-label="Close chatbot"
            className="p-1.5 text-zinc-200 hover:text-white hover:bg-white/10 rounded-md cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* File Focus Selector */}
      <div className="px-3.5 py-2.5 border-b border-[#e4e0d8] bg-[#f7f6f2] space-y-2">
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
        <div className="flex items-center gap-2">
          <label htmlFor="widget-doc-scope" className="text-xs font-medium text-[#52504b] shrink-0">
            Madda:
          </label>
          <select
            id="widget-doc-scope"
            value={effectiveFocusDocId}
            onChange={(e) => {
              onChangeFocusDoc(e.target.value);
              if (activeThreadId) onSelectThread(null);
            }}
            disabled={streaming}
            className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-[#e4e0d8] rounded-lg text-[#171614] focus:outline-none focus:ring-2 focus:ring-[#142d4c]"
          >
            <option value="all">Barnoota &amp; Macaafa Hunda ({filteredScopeDocs.length})</option>
            {filteredScopeDocs.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {String(doc.order).padStart(2, '0')}. {doc.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {displayedMessages.length === 0 && !optimisticUserMsg && (
          <div className="space-y-4 py-2">
            <p className="text-xs text-[#52504b] leading-relaxed">
              Gaaffii kee faayila filatame irratti hundaa’ee gaafadhu — luqqisiiwwan tuquun Macaafa keessa seenuu dandeessa.
            </p>
            <div className="space-y-2">
              {QUICK_PROMPTS.map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => sendMessage(q)}
                  className="w-full text-left px-3 py-2.5 rounded-xl border border-[#e4e0d8] bg-[#f7f6f2] hover:border-[#142d4c]/40 hover:bg-white text-xs text-[#171614] transition-colors cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {displayedMessages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'user' ? (
              <div className="max-w-[85%] bg-[#142d4c] text-white px-3.5 py-2.5 rounded-xl rounded-br-sm text-xs leading-relaxed whitespace-pre-wrap">
                {msg.content}
              </div>
            ) : (
              <div className="w-full space-y-1.5">
                <div className="bg-[#f7f6f2] border border-[#e4e0d8] rounded-xl px-3.5 py-3 prose prose-xs prose-zinc max-w-none prose-headings:font-editorial prose-p:text-xs prose-p:leading-relaxed prose-li:text-xs">
                  <ChatbotMessageContent
                    content={msg.content}
                    onOpenBibleRef={(target) => {
                      setOpen(false);
                      onOpenBibleRef(target);
                    }}
                  />
                </div>
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => handleCopy(msg.id, msg.content)}
                    aria-label="Copy message"
                    className="inline-flex items-center gap-1 text-[11px] text-[#76736c] hover:text-[#171614] shrink-0 cursor-pointer"
                  >
                    {copiedId === msg.id ? (
                      <Check className="w-3 h-3 text-emerald-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {optimisticUserMsg &&
          !displayedMessages.some(
            (m) => m.content === optimisticUserMsg.content && m.id === optimisticUserMsg.id
          ) && (
            <div className="flex justify-end">
              <div className="max-w-[85%] bg-[#142d4c] text-white px-3.5 py-2.5 rounded-xl rounded-br-sm text-xs leading-relaxed whitespace-pre-wrap">
                {optimisticUserMsg.content}
              </div>
            </div>
          )}

        {streaming && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] text-[#76736c]">
              <Loader2 className="w-3 h-3 animate-spin text-[#142d4c]" />
              <span>Faayila irraa deebisaa jira...</span>
            </div>
            <div className="bg-[#f7f6f2] border border-[#e4e0d8] rounded-xl px-3.5 py-3 prose prose-xs prose-zinc max-w-none">
              {streamingText ? (
                <ChatbotMessageContent
                  content={streamingText}
                  onOpenBibleRef={(target) => {
                    setOpen(false);
                    onOpenBibleRef(target);
                  }}
                />
              ) : (
                <p className="text-[#76736c] text-xs">Sakatta’aa jira...</p>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="bg-[#f7f6f2] border border-[#e4e0d8] rounded-xl px-3.5 py-3 text-xs text-[#171614] leading-relaxed">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(input);
        }}
        className="p-3 border-t border-[#e4e0d8] bg-[#f7f6f2]"
      >
        <div className="flex items-end gap-2 bg-white border border-[#e4e0d8] rounded-xl p-1.5 focus-within:ring-2 focus-within:ring-[#142d4c]">
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="Gaaffii kee asitti barreessi..."
            disabled={streaming}
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-xs text-[#171614] placeholder:text-[#76736c] focus:outline-none max-h-24"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            aria-label="Ergi"
            className="p-2 rounded-lg bg-[#142d4c] text-white hover:bg-[#0e2139] disabled:opacity-40 disabled:cursor-not-allowed shrink-0 cursor-pointer"
          >
            {streaming ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
