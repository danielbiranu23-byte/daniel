import { AlertCircle, BookCheck, CheckCircle2, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { authHeaders, extractErrorMessage, safeJson } from '../lib/api';
import type { QuizQuestion, StudyDocument } from '../types';

interface QuizModalProps {
  doc: StudyDocument | null;
  onClose: () => void;
  onQuizCompleted: (docId: string, score: number, total: number) => void;
}

export function QuizModal({ doc, onClose, onQuizCompleted }: QuizModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;

    async function loadQuiz() {
      setLoading(true);
      setError('');
      setQuestions([]);
      setAnswers({});
      setSubmitted(false);

      try {
        const res = await fetch('/api/study/quiz', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ docId: doc?.id }),
        });
        const data = await safeJson<{ error?: string; questions?: QuizQuestion[] }>(res);
        if (!res.ok) {
          throw new Error(extractErrorMessage(data.error, 'Qormaata qopheessuun hin danda’amne.'));
        }
        if (!cancelled) {
          setQuestions(data.questions || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(extractErrorMessage(err, 'Dogoggorri uumameera.'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadQuiz();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  if (!doc) return null;

  const allAnswered = questions.length > 0 && Object.keys(answers).length === questions.length;
  const score = questions.reduce(
    (acc, q, idx) => (answers[idx] === q.correctIndex ? acc + 1 : acc),
    0
  );

  const handleSubmit = () => {
    setSubmitted(true);
    onQuizCompleted(doc.id, score, questions.length);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b192b]/72 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quiz-modal-title"
    >
      <div className="sanctuary-card rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl animate-enter">
        <div className="px-6 py-4 border-b border-[#dfd9cd] bg-gradient-to-b from-[#faf8f4] to-[#f3efe6] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.12em] font-semibold text-[#9a6b16] text-3d-gold">
              Qormaata Hubannoo Barnootaa
            </p>
            <h2 id="quiz-modal-title" className="font-editorial text-lg font-bold text-[#171614] text-3d-display truncate mt-0.5">
              {doc.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close quiz"
            className="btn-3d-secondary p-2 text-[#52504b] hover:text-[#171614] rounded-xl shrink-0 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {loading && (
            <div className="py-12 flex flex-col items-center justify-center text-center gap-3">
              <Loader2 className="w-7 h-7 animate-spin text-[#142d4c]" />
              <p className="text-sm text-[#52504b]">
                Faayila barnootaa irraa gaaffilee qopheessaa jira...
              </p>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-800 text-sm flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Qormaata uumuun hin danda’amne</p>
                <p className="mt-1 text-red-700">{error}</p>
              </div>
            </div>
          )}

          {!loading && !error && questions.length > 0 && (
            <>
              {submitted && (
                <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <BookCheck className="w-5 h-5 text-emerald-700 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-emerald-950">
                        Bu’aa Qormaataa: <span className="font-mono tabular-nums">{score} / {questions.length}</span>
                      </p>
                      <p className="text-xs text-emerald-800">
                        Boqonnaan kun akka xummurametti galmaa’eera.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-6">
                {questions.map((q, qIdx) => {
                  const selected = answers[qIdx];
                  return (
                    <div key={qIdx} className="pb-6 border-b border-[#e4e0d8] last:border-b-0 last:pb-0">
                      <p className="text-sm font-semibold text-[#171614] mb-3">
                        <span className="font-mono tabular-nums text-[#9a6b16] mr-2">
                          {String(qIdx + 1).padStart(2, '0')}.
                        </span>
                        {q.question}
                      </p>

                      <div className="space-y-2">
                        {q.options.map((opt, optIdx) => {
                          const isSelected = selected === optIdx;
                          const isCorrect = q.correctIndex === optIdx;

                          let style = 'border-[#e4e0d8] bg-white text-[#171614] hover:border-[#142d4c]/40';
                          if (submitted) {
                            if (isCorrect) {
                              style = 'border-emerald-500 bg-emerald-50 text-emerald-950';
                            } else if (isSelected && !isCorrect) {
                              style = 'border-red-400 bg-red-50 text-red-900';
                            } else {
                              style = 'border-[#e4e0d8] bg-[#f7f6f2] text-[#76736c]';
                            }
                          } else if (isSelected) {
                            style = 'border-[#142d4c] bg-[#142d4c]/6 text-[#142d4c] font-medium';
                          }

                          return (
                            <button
                              key={optIdx}
                              type="button"
                              disabled={submitted}
                              onClick={() => setAnswers((prev) => ({ ...prev, [qIdx]: optIdx }))}
                              className={`w-full text-left px-4 py-2.5 rounded-xl border text-sm transition-colors flex items-center justify-between gap-3 cursor-pointer disabled:cursor-default ${style}`}
                            >
                              <span>{opt}</span>
                              {submitted && isCorrect && (
                                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {submitted && (
                        <div className="mt-3 p-3.5 rounded-xl bg-[#f7f6f2] border border-[#e4e0d8] text-xs text-[#52504b] space-y-1">
                          <p>
                            <span className="font-semibold text-[#171614]">Ibsa: </span>
                            {q.explanation}
                          </p>
                          <p className="text-[#9a6b16] font-mono">Luqqisii: {q.scriptureRef}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#dfd9cd] bg-gradient-to-b from-[#faf8f4] to-[#f2eee4] flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="btn-3d-secondary px-4 py-2 text-sm font-medium text-[#52504b] rounded-xl cursor-pointer"
          >
            Cufi
          </button>
          {!submitted && !loading && questions.length > 0 && (
            <button
              type="button"
              disabled={!allAnswered}
              onClick={handleSubmit}
              className="btn-3d-primary px-4 py-2 text-sm font-medium rounded-xl disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              Deebii Mirkaneessi
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
