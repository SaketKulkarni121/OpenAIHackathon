import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import * as pdfjs from "pdfjs-dist";
import { PdfLoader, PdfHighlighter, Highlight, AreaHighlight, type IHighlight, type NewHighlight } from "react-pdf-highlighter";
import "react-pdf-highlighter/dist/style.css";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Maximize2, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/toast";
import { auth, db, isFirebaseConfigured } from "@/firebase";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { suggestComment, askExpert, suggestNextFocus, type CommentSuggestion, type ChatMessage } from "@/lib/ai";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc as unknown as string;

type PdfEditorProps = {
  projectId: string;
  projectName?: string;
  pdfId: string;
  url: string; // object URL or remote URL
};

type StoredHighlights = {
  highlights: IHighlight[];
  updatedAt?: unknown;
};

type Severity = "low" | "medium" | "high" | "critical";
type Category = "general" | "design" | "safety" | "spec" | "cost" | "schedule" | "other";
type CommentReply = { id: string; text: string; authorUid?: string | null; createdAt: number };
type HighlightMeta = { severity: Severity; category: Category; replies: CommentReply[] };
type RichHighlight = IHighlight & { meta?: HighlightMeta };

export function PdfEditor({ projectId, projectName, pdfId, url }: PdfEditorProps) {
  const [highlights, setHighlights] = useState<RichHighlight[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfPlainText, setPdfPlainText] = useState<string>("");
  const aiAbortRef = useRef<AbortController | null>(null);
  const [commentsOpen, setCommentsOpen] = useState<boolean>(true);
  const [assistantOpen, setAssistantOpen] = useState<boolean>(true);
  const { toast: pushToast } = useToast();

  // Tip UI that absorbs unknown props from react-pdf-highlighter (e.g., onUpdate)
  function NewCommentTip(props: {
    onConfirm: (data: { text: string; severity: Severity; category: Category }) => void;
    onCancel: () => void;
    onOpen?: () => void;
    initialText?: string;
    initialSeverity?: Severity;
    initialCategory?: Category;
    generateSuggestion: () => Promise<CommentSuggestion | null>;
    // absorb unknown props without passing to DOM
    [key: string]: unknown;
  }) {
    const { onConfirm, onCancel, onOpen } = props;
    const [text, setText] = useState<string>(String(props.initialText ?? ""));
    const [severity, setSeverity] = useState<Severity>(props.initialSeverity ?? "medium");
    const [category, setCategory] = useState<Category>(props.initialCategory ?? "general");
    const [isSuggesting, setIsSuggesting] = useState(false);

    useEffect(() => {
      onOpen?.();
      void handleSuggest();
      // run once on mount
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function handleSuggest() {
      try {
        setIsSuggesting(true);
        const s = await props.generateSuggestion();
        if (s) {
          if (s.text) setText(s.text);
          if (s.severity) setSeverity(s.severity);
          if (s.category) setCategory(s.category);
        }
      } finally {
        setIsSuggesting(false);
      }
    }

    return (
      <div className="rounded-md border bg-white p-2 shadow-md text-xs w-72">
        <div className="mb-2 font-medium">New comment</div>
        <textarea
          className="mb-2 h-20 w-full resize-none rounded-md border p-2 text-sm"
          placeholder="Describe the issue"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mb-2 grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 text-[11px] text-neutral-600">Severity</div>
            <select className="w-full rounded-md border px-2 py-1 text-sm" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <div className="mb-1 text-[11px] text-neutral-600">Type</div>
            <select className="w-full rounded-md border px-2 py-1 text-sm" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              <option value="general">General</option>
              <option value="design">Design</option>
              <option value="safety">Safety</option>
              <option value="spec">Spec</option>
              <option value="cost">Cost</option>
              <option value="schedule">Schedule</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div className="mb-2">
          <label className="mb-1 block text-[11px] text-neutral-600">AI suggestion</label>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleSuggest} disabled={isSuggesting}>
              {isSuggesting ? "Suggesting…" : "Suggest"}
            </Button>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button
            type="button"
            size="sm"
            onClick={() => onConfirm({ text: text.trim(), severity, category })}
          >
            Save
          </Button>
        </div>
      </div>
    );
  }

  const viewerRef = useRef<HTMLDivElement | null>(null);

  // Zoom state
  const [fitToWidth, setFitToWidth] = useState<boolean>(true);
  const [scale, setScale] = useState<number>(1);

  const zoomIn = useCallback(() => {
    if (fitToWidth) {
      setFitToWidth(false);
      setScale(1.25);
      return;
    }
    setScale((s) => Math.min(4, parseFloat((s * 1.1).toFixed(3))));
  }, [fitToWidth]);

  const zoomOut = useCallback(() => {
    if (fitToWidth) {
      setFitToWidth(false);
      setScale(0.9);
      return;
    }
    setScale((s) => Math.max(0.25, parseFloat((s / 1.1).toFixed(3))));
  }, [fitToWidth]);

  const fitWidth = useCallback(() => {
    setFitToWidth(true);
  }, []);

  function severityClasses(severity?: Severity): string {
    switch (severity) {
      case "low":
        return "bg-emerald-100 text-emerald-800 border-emerald-200";
      case "medium":
        return "bg-amber-100 text-amber-900 border-amber-200";
      case "high":
        return "bg-orange-100 text-orange-900 border-orange-200";
      case "critical":
        return "bg-red-100 text-red-800 border-red-200";
      default:
        return "bg-neutral-100 text-neutral-800 border-neutral-200";
    }
  }

  function categoryClasses(): string {
    return "bg-neutral-50 text-neutral-700 border-neutral-200";
  }

  function createReply(text: string): CommentReply {
    return { id: String(Math.random()).slice(2), text, authorUid: auth?.currentUser?.uid ?? null, createdAt: Date.now() };
  }

  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  function setReplyDraft(id: string, value: string) {
    setReplyDrafts((p) => ({ ...p, [id]: value }));
  }
  function clearReplyDraft(id: string) {
    setReplyDrafts((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
  }

  // Sorting and filtering by severity then page order
  function severityRank(sev?: Severity): number {
    switch (sev) {
      case "critical":
        return 4;
      case "high":
        return 3;
      case "medium":
        return 2;
      case "low":
        return 1;
      default:
        return 0;
    }
  }

  const [severityFilter, setSeverityFilter] = useState<"all" | Severity>("all");

  const visibleHighlights = useMemo(() => {
    const filtered = highlights.filter((h) => {
      const meta = (h as RichHighlight).meta;
      if (severityFilter === "all") return true;
      return (meta?.severity ?? "medium") === severityFilter;
    });
    filtered.sort((a, b) => {
      const aMeta = (a as RichHighlight).meta;
      const bMeta = (b as RichHighlight).meta;
      const sevDelta = severityRank(bMeta?.severity) - severityRank(aMeta?.severity);
      if (sevDelta !== 0) return sevDelta;
      const ap = a.position.pageNumber;
      const bp = b.position.pageNumber;
      return ap - bp;
    });
    return filtered;
  }, [highlights, severityFilter]);

  const annotationDocRef = useMemo(() => {
    if (!db) return null;
    return doc(db, "projects", projectId, "pdfs", pdfId, "annotations", "default");
  }, [projectId, pdfId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!isFirebaseConfigured || !db || !annotationDocRef) return;
      setIsLoading(true);
      setError(null);
      try {
        const snap = await getDoc(annotationDocRef);
        const data = (snap.data() as StoredHighlights | undefined) ?? undefined;
        if (!cancelled && data?.highlights) {
          setHighlights(data.highlights);
        } else if (!cancelled) {
          setHighlights([]);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load annotations");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [annotationDocRef]);

  // Extract plain text from the loaded PDF for AI context (first N pages for performance)
  useEffect(() => {
    let cancelled = false;
    async function extract(pdfUrl: string) {
      try {
        const loadingTask = pdfjs.getDocument({ url: pdfUrl });
        const doc = await loadingTask.promise;
        const numPages = doc.numPages;
        const MAX_PAGES = Math.min(numPages, 20);
        const chunks: string[] = [];
        for (let i = 1; i <= MAX_PAGES; i++) {
          const page = await doc.getPage(i);
          const textContent = await page.getTextContent();
          const text = (textContent.items as Array<{ str?: string }>).map((it) => it.str || "").join(" ");
          chunks.push(`\n\n[Page ${i}]\n${text}`);
        }
        if (!cancelled) setPdfPlainText(chunks.join("\n"));
      } catch {/* ignore */}
    }
    if (url) void extract(url);
    return () => {
      cancelled = true;
    };
  }, [url]);

  const persistHighlights = useCallback(
    async (next: IHighlight[]) => {
      if (!isFirebaseConfigured || !db || !annotationDocRef) return;
      try {
        await setDoc(
          annotationDocRef,
          { highlights: next, updatedAt: serverTimestamp() },
          { merge: true }
        );
      } catch (e) {
        console.error(e);
      }
    },
    [annotationDocRef]
  );

  const addHighlightWithMeta = useCallback(
    (highlight: NewHighlight, commentText: string, meta: HighlightMeta) => {
      const next: RichHighlight = {
        ...(highlight as IHighlight),
        id: String(Math.random()).slice(2),
        comment: { text: commentText, emoji: "" },
        meta,
      } as unknown as RichHighlight;
      setHighlights((prev) => {
        const updated: RichHighlight[] = [next, ...prev];
        void persistHighlights(updated as unknown as IHighlight[]);
        return updated;
      });
    },
    [persistHighlights]
  );

  type HighlightPosition = IHighlight["position"];
  type HighlightContent = IHighlight["content"];

  const updateHighlight = useCallback(
    (id: string, position: HighlightPosition, content: HighlightContent) => {
      setHighlights((prev) => {
        const updated = prev.map((h) => (h.id === id ? ({ ...h, position, content } as RichHighlight) : h));
        void persistHighlights(updated as unknown as IHighlight[]);
        return updated;
      });
    },
    [persistHighlights]
  );

  const removeHighlight = useCallback(
    (id: string) => {
      setHighlights((prev) => {
        const updated = prev.filter((h) => h.id !== id);
        void persistHighlights(updated as unknown as IHighlight[]);
        return updated as RichHighlight[];
      });
    },
    [persistHighlights]
  );

  const handleExport = useCallback(() => {
    const payload: StoredHighlights = { highlights };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `annotations-${pdfId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [highlights, pdfId]);

  // Import flow removed by request; annotations auto-load from Firestore and auto-save on change.

  return (
    <div className="flex h-full w-full max-w-full overflow-hidden min-w-0">
      <div className="flex-1 w-full max-w-full overflow-hidden min-w-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-3">
            <div className="text-sm text-neutral-600">PDF Editor</div>
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="sm" onClick={zoomOut} title="Zoom out">
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={zoomIn} title="Zoom in">
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={fitWidth} title="Fit to width">
                <Maximize2 className="h-4 w-4" />
              </Button>
              <span className="ml-2 text-xs text-neutral-600 select-none">
                {fitToWidth ? "Fit" : `${Math.round(scale * 100)}%`}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleExport}>
              Export JSON
            </Button>
          </div>
        </div>
        <div ref={viewerRef} className="pdf-editor-viewer relative z-0 h-[calc(100%-41px)] w-full max-w-full overflow-auto bg-neutral-100 flex justify-center items-start min-w-0">
          <PdfLoader url={url} beforeLoad={<div className="p-4 text-sm text-neutral-500">Loading document…</div>}>
            {(pdfDocument) => (
              <div className="inline-block">
              <PdfHighlighter
                  key={`${pdfId}:${fitToWidth ? 'fit' : scale.toFixed(3)}`}
                  pdfDocument={pdfDocument as unknown as never}
                  enableAreaSelection={(event) => (event as unknown as ReactMouseEvent).altKey}
                  pdfScaleValue={fitToWidth ? ("page-width" as unknown as never) : (scale as unknown as never)}
                  onScrollChange={() => {}}
                scrollRef={(scrollTo) => {
                  // Attach next-focus action to scroll to a specific highlight/page
                  (window as unknown as { __pdfScrollTo?: typeof scrollTo }).__pdfScrollTo = scrollTo;
                }}
                  onSelectionFinished={(position, content, hideTipAndSelection) => {
                    const generateSuggestion = async () => {
                      try {
                        aiAbortRef.current?.abort();
                        aiAbortRef.current = new AbortController();
                        return await suggestComment({
                          pdfText: pdfPlainText,
                          highlightText: content?.text || "",
                          pageNumber: position.pageNumber,
                          projectName,
                          model: (import.meta.env.VITE_OPENAI_MODEL as string) || "gpt-5",
                          apiKey: import.meta.env.VITE_OPENAI_API_KEY as string | undefined,
                          abortSignal: aiAbortRef.current.signal,
                        });
                      } catch {
                        return null;
                      }
                    };
                    return (
                      <NewCommentTip
                        onOpen={() => {}}
                        onCancel={hideTipAndSelection}
                        generateSuggestion={generateSuggestion}
                        onConfirm={({ text, severity, category }) => {
                          const meta: HighlightMeta = { severity, category, replies: [] };
                          addHighlightWithMeta({ content, position } as NewHighlight, text, meta);
                          hideTipAndSelection();
                        }}
                      />
                    );
                  }}
                  highlightTransform={(highlight, index, setTip, hideTip, viewportToScaled, _screenshot, isScrolledTo) => {
                    const isTextHighlight = !(highlight as unknown as { content?: { image?: unknown } }).content?.image;
                  const onEnter = () => setTip(highlight, () => popupContent);
                  const onLeave = () => hideTip();
                  const component = isTextHighlight ? (
                    // Cast is used to attach DOM event handlers supported by the underlying element
                    (
                      <Highlight
                        isScrolledTo={isScrolledTo}
                        position={highlight.position}
                        comment={highlight.comment}
                        {...({ onMouseEnter: onEnter, onMouseLeave: onLeave } as unknown as Record<string, unknown>)}
                      />
                    )
                  ) : (
                    (
                      <AreaHighlight
                        isScrolledTo={isScrolledTo}
                        highlight={highlight}
                        onChange={(boundingRect) => {
                          updateHighlight(
                            highlight.id,
                            { boundingRect: viewportToScaled(boundingRect), pageNumber: highlight.position.pageNumber, rects: [], usePdfCoordinates: false },
                            { text: "", image: (highlight as unknown as { content?: { image?: string } }).content?.image }
                          );
                        }}
                        {...({ onMouseEnter: onEnter, onMouseLeave: onLeave } as unknown as Record<string, unknown>)}
                      />
                    )
                  );
                  const commentText = (highlight.comment?.text as string) || "(no comment)";
                  const popupContent = (
                    <div className="max-w-[280px] text-xs">
                      {(() => {
                        const meta = (highlight as RichHighlight).meta || { severity: "medium", category: "general", replies: [] };
                        return (
                          <div>
                            <div className="mb-2 flex items-center gap-2">
                              <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] ${severityClasses(meta.severity as Severity)}`}>{meta.severity}</span>
                              <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] ${categoryClasses()}`}>{meta.category}</span>
                            </div>
                            <div className="whitespace-pre-wrap text-neutral-800">{highlight.comment?.text || "(no comment)"}</div>
                            {meta.replies && meta.replies.length > 0 && (
                              <div className="mt-2 space-y-2">
                                {meta.replies.map((r) => (
                                  <div key={r.id} className="rounded-md border bg-white p-2 text-[11px] text-neutral-700">
                                    {r.text}
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <input
                                placeholder="Add reply"
                                className="h-8 w-full rounded-md border px-2 text-[12px] sm:h-7 sm:w-auto sm:flex-1"
                                value={replyDrafts[highlight.id] ?? ""}
                                onChange={(e) => setReplyDraft(highlight.id, e.target.value)}
                              />
                              <Button
                                type="button"
                                size="sm"
                                className="shrink-0"
                                onClick={() => {
                                  const val = (replyDrafts[highlight.id] ?? "").trim();
                                  if (!val) return;
                                  const reply = createReply(val);
                                  setHighlights((prev) => {
                                    const updated = prev.map((h) => {
                                      if (h.id !== highlight.id) return h as RichHighlight;
                                      const existing = (h as RichHighlight).meta || { severity: "medium", category: "general", replies: [] };
                                      return { ...h, meta: { ...existing, replies: [reply, ...(existing.replies || [])] } } as RichHighlight;
                                    });
                                    void persistHighlights(updated as unknown as IHighlight[]);
                                    return updated as RichHighlight[];
                                  });
                                  clearReplyDraft(highlight.id);
                                }}
                              >
                                Reply
                              </Button>
                              <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => removeHighlight(highlight.id)}>
                                Delete
                              </Button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                  return (
                    <div key={index} title={commentText} style={{ pointerEvents: "auto" }}>{component}</div>
                  );
                  }}
                  highlights={highlights}
                />
              </div>
            )}
          </PdfLoader>
        </div>
      </div>
      <aside className="w-80 shrink-0 border-l bg-white relative z-10">
        <div className="p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <button type="button" className="flex items-center gap-2 text-sm font-medium" onClick={() => setCommentsOpen((v) => !v)}>
              {commentsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Comments
            </button>
            <div className="flex items-center gap-1">
              <label htmlFor="sev-filter" className="text-[11px] text-neutral-500">Severity</label>
              <select
                id="sev-filter"
                className="rounded-md border px-2 py-1 text-[12px]"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as "all" | Severity)}
              >
                <option value="all">All</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          <Separator />
        </div>
        <div className="h-[calc(100%-52px)] space-y-3 overflow-y-auto p-3">
          {isLoading && <div className="text-xs text-neutral-500">Loading annotations…</div>}
          {error && <div className="text-xs text-red-600">{error}</div>}
          {!isLoading && !error && highlights.length === 0 && (
            <div className="text-xs text-neutral-500">No comments yet. Select text or Alt+Drag to create one.</div>
          )}
          {commentsOpen && (
            <div className="space-y-3">
          {/* Comments list */}
          {visibleHighlights.map((h) => {
            const meta = (h as RichHighlight).meta || { severity: "medium", category: "general", replies: [] };
            return (
              <Card key={h.id} className="overflow-hidden">
                <CardContent className="p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500">Page {h.position.pageNumber}</div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] ${severityClasses(meta.severity as Severity)}`}>{meta.severity}</span>
                      <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] ${categoryClasses()}`}>{meta.category}</span>
                    </div>
                  </div>
                  <div className="text-sm font-medium">{h.comment?.text || "(no comment)"}</div>
                  {h.content?.text && <div className="mt-1 line-clamp-3 text-xs text-neutral-600">{h.content.text}</div>}
                  {meta.replies && meta.replies.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {meta.replies.map((r) => (
                        <div key={r.id} className="rounded-md border bg-white p-2 text-[11px] text-neutral-700">
                          {r.text}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      placeholder="Add reply"
                      className="h-9 w-full rounded-md border px-2 text-[12px] sm:h-8 sm:w-auto sm:flex-1"
                      value={replyDrafts[h.id] ?? ""}
                      onChange={(e) => setReplyDraft(h.id, e.target.value)}
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="shrink-0"
                      onClick={() => {
                        const val = (replyDrafts[h.id] ?? "").trim();
                        if (!val) return;
                        const reply = createReply(val);
                        setHighlights((prev) => {
                          const updated = prev.map((item) => {
                            if (item.id !== h.id) return item as RichHighlight;
                            const existing = (item as RichHighlight).meta || { severity: "medium", category: "general", replies: [] };
                            return { ...item, meta: { ...existing, replies: [reply, ...(existing.replies || [])] } } as RichHighlight;
                          });
                          void persistHighlights(updated as unknown as IHighlight[]);
                          return updated as RichHighlight[];
                        });
                        clearReplyDraft(h.id);
                      }}
                    >
                      Reply
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => removeHighlight(h.id)}>
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
            </div>
          )}

          {/* AI Assistant collapsible */}
          <div className="pt-2">
            <button type="button" className="mb-2 flex w-full items-center gap-2 text-sm font-medium" onClick={() => setAssistantOpen((v) => !v)}>
              {assistantOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              AI Assistant
            </button>
            <Separator />
            {assistantOpen && (
              <div className="mt-2">
                <ExpertBox pdfText={pdfPlainText} onFocusNext={async () => {
                  const apiKey = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
                  const next = await suggestNextFocus({ pdfText: pdfPlainText, apiKey });
                  if (!next) return;
                  // Scroll to page if provided
                  const scrollTo = (window as unknown as { __pdfScrollTo?: (h: RichHighlight) => void }).__pdfScrollTo;
                  if (scrollTo && typeof next.pageNumber === 'number') {
                    const fake = { position: { pageNumber: next.pageNumber } } as unknown as RichHighlight;
                    // Library's scrollTo accepts a highlight-like object
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    scrollTo(fake);
                  }
                   // Offer to auto-comment via toast
                   const pageNumber = typeof next.pageNumber === 'number' ? next.pageNumber : 1;
                   pushToast({
                     title: 'AI suggestion',
                     description: `Page ${pageNumber} — ${next.suggestion.text}\n(severity: ${next.suggestion.severity}, type: ${next.suggestion.category})`,
                     actionLabel: 'Add comment',
                     onAction: () => {
                       const position = {
                         pageNumber,
                         boundingRect: { x1: 0.05, y1: 0.05, x2: 0.95, y2: 0.15 },
                         rects: [],
                         usePdfCoordinates: true,
                       } as unknown as HighlightPosition;
                       const content = { text: '', image: undefined } as unknown as HighlightContent;
                       const meta: HighlightMeta = { severity: next.suggestion.severity as Severity, category: next.suggestion.category as Category, replies: [] };
                       addHighlightWithMeta({ content, position } as NewHighlight, next.suggestion.text, meta);
                     },
                   });
                }} />
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function ExpertBox({ pdfText, onFocusNext }: { pdfText: string; onFocusNext?: () => Promise<void> | void }) {
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hint, setHint] = useState<string | null>("Type @search to fetch web info, @think for deeper reasoning.");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    const m = query.match(/^@(\w+)/);
    if (m) {
      const tag = m[1].toLowerCase();
      if (tag === "search") setHint("Search mode: will fetch recent info from the web");
      else if (tag === "think") setHint("Critical thinking: will reason more deeply before answering");
      else setHint(null);
    } else {
      setHint(null);
    }
  }, [query]);

  async function ask() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setIsLoading(true);
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
    const nextHistory = [...messages, { role: 'user', content: trimmed } as ChatMessage];
    setMessages(nextHistory);
    setQuery("");
    try {
      const res = await askExpert({ pdfText, question: trimmed, apiKey, history: nextHistory });
      setMessages((prev) => [...prev, { role: 'assistant', content: res || "(no answer)" }]);
    } finally {
      setIsLoading(false);
    }
  }

  function clearHistory() {
    setMessages([]);
    setHint("Type @search to fetch web info, @think for deeper reasoning.");
  }

  return (
    <Card className="flex h-64 flex-col">
      <CardContent className="flex h-full flex-col p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium">Expert Q&A</div>
          <div className="flex items-center gap-2">
            {hint && <div className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">{hint}</div>}
            <Button type="button" size="sm" variant="outline" onClick={clearHistory}>Clear</Button>
            {onFocusNext && (
              <Button type="button" size="sm" onClick={() => void onFocusNext()}>Focus next</Button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto rounded-md border bg-neutral-50 p-2">
          {messages.length === 0 ? (
            <div className="text-[11px] text-neutral-500">Ask anything about the document. Use @search to pull recent web info or @think to reason more deeply.</div>
          ) : (
            <div className="space-y-2">
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'text-[12px] text-neutral-900' : 'text-[12px] text-indigo-800'}>
                  <span className="mr-1 font-medium">{m.role === 'user' ? 'You:' : 'Assistant:'}</span>
                  <span className="whitespace-pre-wrap">{m.content}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            className="h-8 flex-1 rounded-md border px-2 text-[12px]"
            placeholder='Ask (use @search or @think)'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void ask(); } }}
          />
          <Button type="button" size="sm" onClick={ask} disabled={isLoading || !query.trim()} title="Send">
            ↑
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default PdfEditor;


