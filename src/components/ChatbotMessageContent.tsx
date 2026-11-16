import { BookOpen } from 'lucide-react';
import Markdown from 'react-markdown';
import { linkifyScriptureMarkdown, parseBibleRefHref } from '../lib/scriptureLinks';
import type { BibleReferenceTarget } from '../types';

interface ChatbotMessageContentProps {
  content: string;
  onOpenBibleRef?: (target: BibleReferenceTarget) => void;
}

export function ChatbotMessageContent({ content, onOpenBibleRef }: ChatbotMessageContentProps) {
  const linked = linkifyScriptureMarkdown(content);

  return (
    <Markdown
      components={{
        a: ({ href, children, ...props }) => {
          const refTarget = parseBibleRefHref(href);
          if (refTarget && onOpenBibleRef) {
            return (
              <button
                type="button"
                onClick={() => onOpenBibleRef(refTarget)}
                title="Macaafa Qulqulluu keessatti bakka barreeffamichaa bani"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-[#142d4c]/8 border border-[#142d4c]/20 text-[#142d4c] font-semibold hover:bg-[#142d4c] hover:text-white hover:border-[#142d4c] transition-colors cursor-pointer align-baseline no-underline text-[inherit]"
              >
                <BookOpen className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span>{children}</span>
              </button>
            );
          }
          return (
            <a href={href} {...props}>
              {children}
            </a>
          );
        },
      }}
    >
      {linked}
    </Markdown>
  );
}
