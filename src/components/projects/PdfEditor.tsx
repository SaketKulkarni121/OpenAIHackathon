import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import * as pdfjs from "pdfjs-dist";
import { PdfLoader, PdfHighlighter, Highlight, Popup, AreaHighlight, type IHighlight, type NewHighlight } from "react-pdf-highlighter";
import "react-pdf-highlighter/dist/style.css";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { auth, db, isFirebaseConfigured } from "@/firebase";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc as unknown as string;

type PdfEditorProps = {
  projectId: string;
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

export function PdfEditor({ projectId, pdfId, url }: PdfEditorProps) {
  const [highlights, setHighlights] = useState<RichHighlight[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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
                  scrollRef={() => {
                    // No-op hook for scrolling to highlight
                  }}
                  onSelectionFinished={(position, content, hideTipAndSelection) => {
                    let severityEl: HTMLSelectElement | null = null;
                    let categoryEl: HTMLSelectElement | null = null;
                    let textEl: HTMLTextAreaElement | null = null;
                    return (
                      <div className="rounded-md border bg-white p-2 shadow-md text-xs w-72">
                        <div className="mb-2 font-medium">New comment</div>
                        <div className="mb-2 grid grid-cols-2 gap-2">
                          <div>
                            <div className="mb-1 text-[11px] text-neutral-600">Severity</div>
                            <select ref={(el) => { severityEl = el; }} className="w-full rounded-md border px-2 py-1 text-sm" defaultValue="medium">
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                              <option value="critical">Critical</option>
                            </select>
                          </div>
                          <div>
                            <div className="mb-1 text-[11px] text-neutral-600">Type</div>
                            <select ref={(el) => { categoryEl = el; }} className="w-full rounded-md border px-2 py-1 text-sm" defaultValue="general">
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
                        <textarea ref={(el) => { textEl = el; }} className="mb-2 h-20 w-full resize-none rounded-md border p-2 text-sm" placeholder="Describe the issue" />
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={hideTipAndSelection}>Cancel</Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              const severity = (severityEl?.value as Severity) || "medium";
                              const category = (categoryEl?.value as Category) || "general";
                              const text = (textEl?.value || "").trim();
                              const meta: HighlightMeta = { severity, category, replies: [] };
                              addHighlightWithMeta({ content, position } as NewHighlight, text, meta);
                              hideTipAndSelection();
                            }}
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    );
                  }}
                  highlightTransform={(highlight, index, setTip, hideTip, viewportToScaled, _screenshot, isScrolledTo) => {
                    const isTextHighlight = !(highlight as unknown as { content?: { image?: unknown } }).content?.image;
                    const component = isTextHighlight ? (
                      <Highlight isScrolledTo={isScrolledTo} position={highlight.position} comment={highlight.comment} />
                    ) : (
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
                      />
                    );
                    return (
                      <Popup
                        popupContent={
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
                        }
                        onMouseOver={(popupContent) => setTip(highlight, () => popupContent)}
                        onMouseOut={hideTip}
                        key={index}
                      >
                        {component}
                      </Popup>
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
        <div className="p-3">
          <div className="mb-2 text-sm font-medium">Comments</div>
          <Separator />
        </div>
        <div className="h-[calc(100%-52px)] space-y-2 overflow-y-auto p-3">
          {isLoading && <div className="text-xs text-neutral-500">Loading annotations…</div>}
          {error && <div className="text-xs text-red-600">{error}</div>}
          {!isLoading && !error && highlights.length === 0 && (
            <div className="text-xs text-neutral-500">No comments yet. Select text or Alt+Drag to create one.</div>
          )}
          {highlights.map((h) => {
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
      </aside>
    </div>
  );
}

export default PdfEditor;


