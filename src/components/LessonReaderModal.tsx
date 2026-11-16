import { CheckCircle2, FileText, MessageSquare, X } from 'lucide-react';
import Markdown from 'react-markdown';
import type { StudyDocument } from '../types';

interface LessonReaderModalProps {
  doc: StudyDocument | null;
  isCompleted: boolean;
  onClose: () => void;
  onToggleComplete: (docId: string, completed: boolean) => void;
  onAskChatbot: (doc: StudyDocument) => void;
}

export function LessonReaderModal({
  doc,
  isCompleted,
  onClose,
  onToggleComplete,
  onAskChatbot,
}: LessonReaderModalProps) {
  if (!doc) return null;

  const isPdf = doc.mimeType === 'application/pdf';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b192b]/55 backdrop-blur-xs p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lesson-reader-title"
    >
      <div className="bg-white border border-[#e4e0d8] rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl animate-enter">
        {/* Header */}
        <div className="px-6 sm:px-8 py-5 border-b border-[#e4e0d8] flex items-start justify-between gap-4 bg-[#f7f6f2]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-[#76736c] font-mono tabular-nums">
              <span className="text-[#9a6b16] font-semibold">
                Boqonnaa {String(doc.order).padStart(2, '0')}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-sans">{doc.category}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate max-w-[200px]">{doc.fileName}</span>
            </div>
            <h2
              id="lesson-reader-title"
              className="font-editorial text-xl sm:text-2xl font-semibold text-[#171614] mt-1 tracking-tight"
            >
              {doc.title}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close lesson reader"
            className="p-2 text-[#76736c] hover:text-[#171614] rounded-lg hover:bg-[#e4e0d8]/50 transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 sm:px-8 py-7">
          {isPdf ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-[#f7f6f2] border border-[#e4e0d8]">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-5 h-5 text-[#142d4c] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#171614] truncate">{doc.fileName}</p>
                    <p className="text-xs text-[#52504b]">
                      Faayila PDF Adminiin ol-kaa’e. Yeroo Chatbot gaafattu kallattiin qabiyyee kana dubbisa.
                    </p>
                  </div>
                </div>
                <a
                  href={`/api/documents/${doc.id}/file`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3.5 py-2 text-xs font-medium text-[#142d4c] bg-white border border-[#142d4c]/25 rounded-lg hover:bg-[#f2efe9] whitespace-nowrap shrink-0"
                >
                  PDF Bani
                </a>
              </div>
              <iframe
                src={`/api/documents/${doc.id}/file`}
                title={doc.title}
                className="w-full h-[55vh] rounded-xl border border-[#e4e0d8] bg-[#f7f6f2]"
              />
            </div>
          ) : (
            <article className="prose prose-zinc max-w-2xl mx-auto prose-headings:font-editorial prose-headings:text-[#171614] prose-p:text-[#2c2a27] prose-p:leading-[1.8] prose-li:text-[#2c2a27] prose-strong:text-[#171614] prose-blockquote:bg-[#f7f6f2] prose-blockquote:border prose-blockquote:border-[#e4e0d8] prose-blockquote:rounded-xl prose-blockquote:py-2.5 prose-blockquote:px-4 prose-blockquote:not-italic">
              <Markdown>{doc.textContent}</Markdown>
            </article>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 sm:px-8 py-4 border-t border-[#e4e0d8] bg-[#f7f6f2] flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onToggleComplete(doc.id, !isCompleted)}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors cursor-pointer ${
              isCompleted
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                : 'bg-white text-[#52504b] border-[#e4e0d8] hover:bg-[#f2efe9]'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{isCompleted ? 'Xummurameera (Deebisi)' : 'Xummurame Jedhii Galmeessi'}</span>
          </button>

          <button
            type="button"
            onClick={() => onAskChatbot(doc)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#142d4c] rounded-lg hover:bg-[#0e2139] shadow-xs transition-colors cursor-pointer"
          >
            <MessageSquare className="w-4 h-4 text-[#f5d08a]" />
            <span>Boqonnaa Kana Chatbot Gaafadhu</span>
          </button>
        </div>
      </div>
    </div>
  );
}
