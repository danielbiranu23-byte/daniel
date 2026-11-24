import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { authHeaders, extractErrorMessage } from '../lib/api';
import type { StudyDocument } from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [renderingPage, setRenderingPage] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [fetchedText, setFetchedText] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const isPdf =
    Boolean(doc) &&
    (doc!.mimeType === 'application/pdf' || doc!.fileName.toLowerCase().endsWith('.pdf'));

  // Load PDF binary OR missing text content securely with authHeaders
  useEffect(() => {
    if (!doc) return;
    const currentDoc = doc;

    let cancelled = false;
    let activeBlobUrl: string | null = null;
    let activeLoadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    let activePdfProxy: pdfjsLib.PDFDocumentProxy | null = null;

    setPdfDoc(null);
    setNumPages(0);
    setPageNum(1);
    setScale(1.2);
    setLoadError('');
    setBlobUrl(null);
    setFetchedText(null);

    if (!isPdf && currentDoc.textContent && currentDoc.textContent.trim().length > 0) {
      setLoadingDoc(false);
      return;
    }

    async function fetchStudyFile() {
      setLoadingDoc(true);
      try {
        const res = await fetch(`/api/documents/${encodeURIComponent(currentDoc.id)}/file`, {
          headers: authHeaders(),
        });

        if (!res.ok) {
          let errMsg = 'Faayila barnootaa kana banuun hin danda’amne.';
          try {
            const j = (await res.json()) as { error?: string };
            if (j?.error) errMsg = j.error;
          } catch {
            // ignore parse error
          }
          throw new Error(errMsg);
        }

        const contentType = (res.headers.get('content-type') || '').toLowerCase();

        if (!isPdf || !contentType.includes('pdf')) {
          const text = await res.text();
          if (!cancelled) {
            setFetchedText(text);
          }
          return;
        }

        const arrayBuf = await res.arrayBuffer();
        if (cancelled) return;

        const blob = new Blob([arrayBuf], { type: 'application/pdf' });
        activeBlobUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setBlobUrl(activeBlobUrl);
        }

        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(arrayBuf),
        });
        activeLoadingTask = loadingTask;
        const loadedPdf = await loadingTask.promise;
        activePdfProxy = loadedPdf;

        if (cancelled) {
          await loadingTask.destroy().catch(() => {});
          return;
        }

        setPdfDoc(loadedPdf);
        setNumPages(loadedPdf.numPages);
        setPageNum(1);
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            extractErrorMessage(err, 'Kitaaba kana banuun hin milkoofne. Maaloo irra deebi’ii yaali.')
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingDoc(false);
        }
      }
    }

    void fetchStudyFile();

    return () => {
      cancelled = true;
      if (activeBlobUrl) {
        URL.revokeObjectURL(activeBlobUrl);
      }
      if (activePdfProxy) {
        void activePdfProxy.cleanup(false).catch(() => {});
      }
      if (activeLoadingTask) {
        void activeLoadingTask.destroy().catch(() => {});
      }
    };
  }, [doc, isPdf]);

  // Render active PDF page onto canvas with crisp HiDPI scaling
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;

    async function renderCurrentPage() {
      setRenderingPage(true);
      try {
        const page = await pdfDoc!.getPage(pageNum);
        if (cancelled || !canvasRef.current) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const containerWidth = containerRef.current?.clientWidth
          ? Math.max(300, containerRef.current.clientWidth - 32)
          : 720;
        const fitScale = Math.min(2.2, Math.max(0.7, (containerWidth / baseViewport.width) * (scale / 1.2)));
        const viewport = page.getViewport({ scale: fitScale });

        const canvas = canvasRef.current;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        renderTask = page.render({
          canvas,
          canvasContext: ctx,
          viewport,
        });
        await renderTask.promise;
      } catch (err) {
        if (!cancelled && (err as { name?: string })?.name !== 'RenderingCancelledException') {
          setLoadError('Fuula PDF kana mul’isuun hin danda’amne. Qabiyyee buufachuun ilaali.');
        }
      } finally {
        if (!cancelled) {
          setRenderingPage(false);
        }
      }
    }

    void renderCurrentPage();

    return () => {
      cancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [pdfDoc, pageNum, scale]);

  if (!doc) return null;

  const displayText =
    fetchedText !== null
      ? fetchedText
      : doc.textContent && doc.textContent.trim().length > 0
        ? doc.textContent
        : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b192b]/72 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lesson-reader-title"
    >
      <div className="sanctuary-card rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl animate-enter">
        {/* Header */}
        <div className="px-6 sm:px-8 py-5 border-b border-[#dfd9cd] flex items-start justify-between gap-4 bg-gradient-to-b from-[#faf8f4] to-[#f3efe6]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#76736c] font-mono tabular-nums">
              <span className="text-[#9a6b16] font-semibold text-3d-gold">
                Boqonnaa {String(doc.order).padStart(2, '0')}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-sans font-medium text-[#52504b]">{doc.category}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate max-w-[220px]">{doc.fileName}</span>
            </div>
            <h2
              id="lesson-reader-title"
              className="font-editorial text-xl sm:text-2xl font-semibold text-[#171614] text-3d-display mt-1 tracking-tight"
            >
              {doc.title}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close lesson reader"
            className="btn-3d-secondary p-2 text-[#52504b] hover:text-[#171614] rounded-xl shrink-0 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div ref={containerRef} className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 bg-[#fcfbf8]">
          {isPdf ? (
            <div className="space-y-4">
              {/* PDF Toolbar */}
              <div className="sanctuary-subsurface rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-[#142d4c] text-[#f5d08a] flex items-center justify-center shrink-0 shadow-xs">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#171614] truncate">{doc.fileName}</p>
                    <p className="text-[11px] text-[#52504b]">
                      {numPages > 0
                        ? `Kitaaba PDF · Fuula ${numPages}`
                        : 'Faayila PDF Adminiin ol-kaa’e'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {numPages > 0 && (
                    <>
                      <div className="tray-3d inline-flex items-center gap-1 p-1 rounded-xl">
                        <button
                          type="button"
                          onClick={() => setPageNum((p) => Math.max(1, p - 1))}
                          disabled={pageNum <= 1}
                          aria-label="Fuula duraa"
                          className="p-1.5 rounded-lg text-[#142d4c] hover:bg-white disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="px-2 text-xs font-mono tabular-nums font-semibold text-[#171614]">
                          {pageNum} / {numPages}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
                          disabled={pageNum >= numPages}
                          aria-label="Fuula itti aanu"
                          className="p-1.5 rounded-lg text-[#142d4c] hover:bg-white disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="tray-3d inline-flex items-center gap-1 p-1 rounded-xl">
                        <button
                          type="button"
                          onClick={() => setScale((s) => Math.max(0.75, +(s - 0.2).toFixed(2)))}
                          aria-label="Xiqqeessi"
                          className="p-1.5 rounded-lg text-[#142d4c] hover:bg-white cursor-pointer"
                        >
                          <ZoomOut className="w-4 h-4" />
                        </button>
                        <span className="px-1.5 text-[11px] font-mono tabular-nums text-[#52504b]">
                          {Math.round((scale / 1.2) * 100)}%
                        </span>
                        <button
                          type="button"
                          onClick={() => setScale((s) => Math.min(2.4, +(s + 0.2).toFixed(2)))}
                          aria-label="Guddisi"
                          className="p-1.5 rounded-lg text-[#142d4c] hover:bg-white cursor-pointer"
                        >
                          <ZoomIn className="w-4 h-4" />
                        </button>
                      </div>
                    </>
                  )}

                  {blobUrl && (
                    <>
                      <a
                        href={blobUrl}
                        download={doc.fileName || 'kitaaba.pdf'}
                        className="btn-3d-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#142d4c] rounded-lg whitespace-nowrap shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Buufadhu</span>
                      </a>
                      <a
                        href={blobUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-3d-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#171614] rounded-lg whitespace-nowrap shrink-0"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Fuula Haaraatti Bani</span>
                      </a>
                    </>
                  )}
                </div>
              </div>

              {/* PDF Canvas Viewport */}
              {loadingDoc ? (
                <div className="sanctuary-card rounded-xl py-16 flex flex-col items-center justify-center gap-3 text-center">
                  <Loader2 className="w-7 h-7 animate-spin text-[#142d4c]" />
                  <p className="text-sm font-medium text-[#52504b]">
                    Kitaaba PDF banaa jira...
                  </p>
                </div>
              ) : loadError ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-sm flex items-start gap-2.5">
                    <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-[#9a6b16]" />
                    <div className="space-y-2">
                      <p className="font-semibold">{loadError}</p>
                      {blobUrl && (
                        <a
                          href={blobUrl}
                          download={doc.fileName || 'kitaaba.pdf'}
                          className="btn-3d-primary inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Faayila PDF Buufadhuu Bani</span>
                        </a>
                      )}
                    </div>
                  </div>
                  {displayText && (
                    <article className="prose prose-zinc max-w-2xl mx-auto">
                      <Markdown>{displayText}</Markdown>
                    </article>
                  )}
                </div>
              ) : pdfDoc ? (
                <div className="relative rounded-xl border border-[#dfd9cd] bg-[#eae5d9] p-3 sm:p-5 flex flex-col items-center overflow-x-auto shadow-inner">
                  {renderingPage && (
                    <div className="absolute top-3 right-3 px-2.5 py-1 rounded-md bg-white/95 border border-[#dfd9cd] text-[11px] font-medium text-[#142d4c] flex items-center gap-1.5 shadow-xs z-10">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Fuula {pageNum}...</span>
                    </div>
                  )}
                  <canvas
                    ref={canvasRef}
                    className="rounded-lg shadow-lg bg-white max-w-full h-auto"
                  />
                  {numPages > 1 && (
                    <div className="mt-4 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setPageNum((p) => Math.max(1, p - 1))}
                        disabled={pageNum <= 1}
                        className="btn-3d-secondary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#142d4c] rounded-lg disabled:opacity-40 cursor-pointer"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        <span>Fuula Duraa</span>
                      </button>
                      <span className="text-xs font-mono tabular-nums text-[#52504b] font-semibold">
                        Fuula {pageNum} / {numPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
                        disabled={pageNum >= numPages}
                        className="btn-3d-secondary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#142d4c] rounded-lg disabled:opacity-40 cursor-pointer"
                      >
                        <span>Fuula Itti Aanu</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ) : displayText ? (
                <article className="prose prose-zinc max-w-2xl mx-auto">
                  <Markdown>{displayText}</Markdown>
                </article>
              ) : null}
            </div>
          ) : loadingDoc ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-7 h-7 animate-spin text-[#142d4c]" />
              <p className="text-sm text-[#52504b]">Barnoota banaa jira...</p>
            </div>
          ) : loadError && !displayText ? (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-900 text-sm flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{loadError}</span>
            </div>
          ) : (
            <article className="prose prose-zinc max-w-2xl mx-auto prose-headings:font-editorial prose-headings:text-[#171614] prose-p:text-[#2c2a27] prose-p:leading-[1.8] prose-li:text-[#2c2a27] prose-strong:text-[#171614] prose-blockquote:bg-[#f7f6f2] prose-blockquote:border prose-blockquote:border-[#e4e0d8] prose-blockquote:rounded-xl prose-blockquote:py-2.5 prose-blockquote:px-4 prose-blockquote:not-italic">
              <Markdown>{displayText || doc.summary}</Markdown>
            </article>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 sm:px-8 py-4 border-t border-[#dfd9cd] bg-gradient-to-b from-[#faf8f4] to-[#f2eee4] flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onToggleComplete(doc.id, !isCompleted)}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl transition-all cursor-pointer ${
              isCompleted
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 border-b-3 hover:bg-emerald-100'
                : 'btn-3d-secondary text-[#52504b]'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{isCompleted ? 'Xummurameera (Deebisi)' : 'Xummurame Jedhii Galmeessi'}</span>
          </button>

          <button
            type="button"
            onClick={() => onAskChatbot(doc)}
            className="btn-3d-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl cursor-pointer"
          >
            <MessageSquare className="w-4 h-4 text-[#f5d08a]" />
            <span>Boqonnaa Kana Chatbot Gaafadhu</span>
          </button>
        </div>
      </div>
    </div>
  );
}
