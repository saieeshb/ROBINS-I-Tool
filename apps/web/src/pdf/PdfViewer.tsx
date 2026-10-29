import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { normalizeWithMap } from '@robercop/shared';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface ViewerDoc {
  id: string;
  label: string;
  role: string;
  parsed: boolean;
}

export interface FocusRequest {
  documentId: string;
  page: number | null;
  text?: string;
  /** Changes on every request so the same location can be focused twice. */
  nonce: number;
}

interface Props {
  docs: ViewerDoc[];
  focus: FocusRequest | null;
  /** Quotations to highlight on the visible pages (linked evidence). */
  highlights?: { documentId: string; page: number | null; text: string }[];
  onSelectText?: (sel: { documentId: string; page: number; text: string }) => void;
  selectLabel?: string;
}

type PdfDoc = pdfjs.PDFDocumentProxy;

interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}

/** Rectangles (in viewport pixels) covering `text` on a page, matched with the same normalization as quotation checks. */
function findRects(items: TextItemLike[], viewport: pdfjs.PageViewport, text: string): { left: number; top: number; width: number; height: number }[] {
  let raw = '';
  for (const it of items) raw += it.str + (it.hasEOL ? '\n' : ' ');
  const hay = normalizeWithMap(raw, true);
  const needle = normalizeWithMap(text.replace(/\s*(?:\.\.\.|…)\s*/g, ' '), true).text;
  const probe = needle.length > 160 ? needle.slice(0, 160) : needle;
  let at = hay.text.indexOf(probe);
  if (at < 0) at = hay.text.toLowerCase().indexOf(probe.toLowerCase());
  if (at < 0 || !probe) return [];
  const start = hay.map[at];
  const end = hay.map[Math.min(hay.map.length - 1, at + needle.length - 1)];
  const rects: { left: number; top: number; width: number; height: number }[] = [];
  let offset = 0;
  items.forEach((it) => {
    const itemStart = offset;
    const itemEnd = offset + it.str.length;
    offset = itemEnd + 1;
    if (itemEnd <= start || itemStart > end || it.str.length === 0) return;
    const tx = pdfjs.Util.transform(viewport.transform, it.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]);
    const fullWidth = it.width * viewport.scale;
    const from = Math.max(0, start - itemStart) / it.str.length;
    const to = Math.min(it.str.length, end - itemStart + 1) / it.str.length;
    rects.push({ left: tx[4] + fullWidth * from, top: tx[5] - fontHeight, width: Math.max(2, fullWidth * (to - from)), height: fontHeight * 1.15 });
  });
  return rects;
}

function PageView({
  pdf,
  pageNo,
  scale,
  documentId,
  marks,
  focusText,
  onVisible
}: {
  pdf: PdfDoc;
  pageNo: number;
  scale: number;
  documentId: string;
  marks: string[];
  focusText: string | null;
  onVisible: (page: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const [content, setContent] = useState<{ items: TextItemLike[]; viewport: pdfjs.PageViewport } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void pdf.getPage(pageNo).then((p) => {
      if (cancelled) return;
      const vp = p.getViewport({ scale });
      setSize({ w: vp.width, h: vp.height });
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNo, scale]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            if (e.intersectionRatio > 0.3) onVisible(pageNo);
          }
        }
      },
      { rootMargin: '600px 0px', threshold: [0, 0.3] }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [pageNo, onVisible]);

  useEffect(() => {
    if (!visible || !size) return;
    let cancelled = false;
    let task: pdfjs.RenderTask | null = null;
    let textLayer: pdfjs.TextLayer | null = null;
    void (async () => {
      const page = await pdf.getPage(pageNo);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current!;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext('2d')!;
      task = page.render({ canvasContext: ctx, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      try {
        await task.promise;
      } catch {
        return;
      }
      if (cancelled) return;
      const tc = await page.getTextContent();
      if (cancelled || !textRef.current) return;
      textRef.current.replaceChildren();
      textLayer = new pdfjs.TextLayer({ textContentSource: tc, container: textRef.current, viewport });
      await textLayer.render();
      // As in the pdf.js viewer: an end-of-content element plus a "selecting" class keep drag-selection inside the page.
      const end = document.createElement('div');
      end.className = 'endOfContent';
      textRef.current?.append(end);
      setContent({ items: tc.items.filter((i) => 'str' in i) as unknown as TextItemLike[], viewport });
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      textLayer?.cancel();
    };
  }, [visible, size, pdf, pageNo, scale]);

  const rects = useMemo(() => {
    if (!content) return [];
    const out: { left: number; top: number; width: number; height: number; focus: boolean }[] = [];
    for (const m of marks) for (const r of findRects(content.items, content.viewport, m)) out.push({ ...r, focus: m === focusText });
    return out;
  }, [content, marks, focusText]);

  return (
    <div
      ref={ref}
      className="pdf-page"
      data-page={pageNo}
      data-doc={documentId}
      style={{ width: size?.w ?? 600, height: size?.h ?? 800, ['--scale-factor' as string]: scale }}
    >
      <span className="pnum">{pageNo}</span>
      <canvas ref={canvasRef} />
      {rects.map((r, i) => (
        <div key={i} className={`hl ${r.focus ? 'focus' : ''}`} style={{ left: r.left, top: r.top, width: r.width, height: r.height }} />
      ))}
      <div
        ref={textRef}
        className="textLayer"
        onMouseDown={(e) => {
          const el = e.currentTarget;
          el.classList.add('selecting');
          const up = () => {
            el.classList.remove('selecting');
            document.removeEventListener('mouseup', up);
          };
          document.addEventListener('mouseup', up);
        }}
      />
    </div>
  );
}

export function PdfViewer({ docs, focus, highlights = [], onSelectText, selectLabel = 'Add as evidence' }: Props) {
  const [docId, setDocId] = useState<string | null>(docs[0]?.id ?? null);
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1.2);
  const [fit, setFit] = useState(true);
  const [page, setPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ x: number; y: number; text: string; page: number } | null>(null);
  const [focusText, setFocusText] = useState<string | null>(null);

  useEffect(() => {
    if (!docId && docs[0]) setDocId(docs[0].id);
  }, [docs, docId]);

  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    setPdf(null);
    setError(null);
    const task = pdfjs.getDocument({ url: `/api/documents/${docId}/file`, isEvalSupported: false });
    task.promise.then(
      (d) => !cancelled && setPdf(d),
      (e) => !cancelled && setError(String(e?.message ?? e))
    );
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [docId]);

  // Fit to width.
  useEffect(() => {
    if (!pdf || !fit) return;
    const el = scrollRef.current;
    if (!el) return;
    const apply = () =>
      void pdf.getPage(1).then((p) => {
        const w = p.getViewport({ scale: 1 }).width;
        const next = Math.max(0.5, Math.min(3, (el.clientWidth - 56) / w));
        setScale((s) => (Math.abs(s - next) > 0.02 ? next : s));
      });
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pdf, fit]);

  const scrollToPage = useCallback((p: number) => {
    const el = scrollRef.current?.querySelector(`[data-page="${p}"]`) as HTMLElement | null;
    if (el) scrollRef.current!.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!focus) return;
    if (focus.documentId !== docId) setDocId(focus.documentId);
    setFocusText(focus.text ?? null);
    const t = setTimeout(() => focus.page && scrollToPage(focus.page), focus.documentId !== docId ? 600 : 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  const marksByPage = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const h of highlights) if (h.documentId === docId && h.page) m.set(h.page, [...(m.get(h.page) ?? []), h.text]);
    if (focus && focus.documentId === docId && focus.page && focus.text) {
      const list = m.get(focus.page) ?? [];
      if (!list.includes(focus.text)) m.set(focus.page, [...list, focus.text]);
    }
    return m;
  }, [highlights, docId, focus]);

  const onMouseUp = () => {
    if (!onSelectText) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    if (!sel || !text || sel.rangeCount === 0) return setSelection(null);
    const node = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
    const pageEl = node?.closest('.pdf-page') as HTMLElement | null;
    if (!pageEl) return setSelection(null);
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setSelection({ x: rect.left + rect.width / 2, y: rect.top - 8, text, page: Number(pageEl.dataset.page) });
  };

  if (docs.length === 0) return <div className="source-empty">No source documents yet. Attach the study PDF in the Study session.</div>;
  const current = docs.find((d) => d.id === docId);
  return (
    <>
      {docs.length > 1 && (
        <div className="source-tabs">
          {docs.map((d) => (
            <button key={d.id} className={d.id === docId ? 'active' : ''} onClick={() => setDocId(d.id)} title={d.label}>
              {d.role === 'reference' ? '📘 ' : ''}
              {d.label}
            </button>
          ))}
        </div>
      )}
      <div className="pdf-toolbar">
        <span className="truncate grow" title={current?.label}>
          {current?.label} {current && !current.parsed && <span style={{ color: '#ffcc80' }}>· not parsed yet</span>}
        </span>
        <span>
          p. {page}
          {pdf ? ` / ${pdf.numPages}` : ''}
        </span>
        <button className="xs" onClick={() => scrollToPage(Math.max(1, page - 1))}>
          ‹
        </button>
        <button className="xs" onClick={() => scrollToPage(Math.min(pdf?.numPages ?? 1, page + 1))}>
          ›
        </button>
        <button className="xs" onClick={() => (setFit(false), setScale((s) => Math.max(0.5, s - 0.15)))}>
          −
        </button>
        <button className="xs" onClick={() => (setFit(false), setScale((s) => Math.min(3, s + 0.15)))}>
          +
        </button>
        <button className="xs" onClick={() => setFit(true)} title="Fit width">
          ↔
        </button>
        {docId && (
          <a className="btn xs" href={`/api/documents/${docId}/file`} target="_blank" rel="noreferrer" style={{ background: '#4b5054', color: '#fff', borderColor: '#5f6468' }}>
            Open ↗
          </a>
        )}
      </div>
      <div className="pdf-scroll" ref={scrollRef} onMouseUp={onMouseUp} onScroll={() => selection && setSelection(null)}>
        {error && <div className="source-empty">Could not open the PDF: {error}</div>}
        {!pdf && !error && <div className="source-empty">Opening…</div>}
        {pdf &&
          Array.from({ length: pdf.numPages }, (_, i) => i + 1).map((p) => (
            <PageView key={`${docId}-${p}`} pdf={pdf} pageNo={p} scale={scale} documentId={docId!} marks={marksByPage.get(p) ?? []} focusText={focusText} onVisible={setPage} />
          ))}
      </div>
      {selection && onSelectText && docId && (
        <div className="select-pop" style={{ left: Math.max(8, selection.x - 90), top: Math.max(56, selection.y - 44) }}>
          <button
            className="sm primary"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onSelectText({ documentId: docId, page: selection.page, text: selection.text });
              setSelection(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            {selectLabel}
          </button>
          <button className="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => void navigator.clipboard?.writeText(selection.text)}>
            Copy
          </button>
        </div>
      )}
    </>
  );
}
