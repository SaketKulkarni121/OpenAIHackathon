import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import * as pdfjs from "pdfjs-dist";
import {
  PdfLoader,
  PdfHighlighter,
  Tip,
  Highlight,
  Popup,
  AreaHighlight,
  type IHighlight,
  type NewHighlight,
} from "react-pdf-highlighter";
import "react-pdf-highlighter/dist/style.css";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { db, isFirebaseConfigured } from "@/firebase";
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

export function PdfEditor({ projectId, pdfId, url }: PdfEditorProps) {
  const [highlights, setHighlights] = useState<IHighlight[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const viewerRef = useRef<HTMLDivElement | null>(null);

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

  const addHighlight = useCallback(
    (highlight: NewHighlight) => {
      const next: IHighlight = {
        ...highlight,
        id: String(Math.random()).slice(2),
      } as IHighlight;
      setHighlights((prev) => {
        const updated = [next, ...prev];
        void persistHighlights(updated);
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
        const updated = prev.map((h) => (h.id === id ? { ...h, position, content } : h));
        void persistHighlights(updated);
        return updated;
      });
    },
    [persistHighlights]
  );

  const removeHighlight = useCallback(
    (id: string) => {
      setHighlights((prev) => {
        const updated = prev.filter((h) => h.id !== id);
        void persistHighlights(updated);
        return updated;
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
    <div className="flex h-full w-full max-w-full overflow-hidden">
      <div className="flex-1 w-full max-w-full overflow-hidden">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="text-sm text-neutral-600">PDF Editor</div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleExport}>
              Export JSON
            </Button>
          </div>
        </div>
        <div ref={viewerRef} className="h-[calc(100%-41px)] w-full max-w-full overflow-auto bg-neutral-100">
          <PdfLoader url={url} beforeLoad={<div className="p-4 text-sm text-neutral-500">Loading document…</div>}>
            {(pdfDocument) => (
              <PdfHighlighter
                pdfDocument={pdfDocument as unknown as never}
                enableAreaSelection={(event) => (event as unknown as ReactMouseEvent).altKey}
                onScrollChange={() => {}}
                scrollRef={() => {
                  // No-op hook for scrolling to highlight
                }}
                onSelectionFinished={(position, content, hideTipAndSelection) => (
                  <Tip
                    onOpen={() => {}}
                    onConfirm={(comment) => {
                      addHighlight({ content, position, comment });
                      hideTipAndSelection();
                    }}
                  />
                )}
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
                        <div className="max-w-[240px] text-xs">
                          <div className="mb-2 font-medium">Comment</div>
                          <div className="whitespace-pre-wrap text-neutral-700">{highlight.comment?.text || "(no comment)"}</div>
                          <div className="mt-2 flex gap-2">
                            <Button type="button" size="sm" variant="outline" onClick={() => removeHighlight(highlight.id)}>
                              Delete
                            </Button>
                          </div>
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
            )}
          </PdfLoader>
        </div>
      </div>
      <aside className="w-80 shrink-0 border-l bg-white">
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
          {highlights.map((h) => (
            <Card key={h.id} className="overflow-hidden">
              <CardContent className="p-3">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">Page {h.position.pageNumber}</div>
                <div className="text-sm font-medium">{h.comment?.text || "(no comment)"}</div>
                {h.content?.text && (
                  <div className="mt-1 line-clamp-3 text-xs text-neutral-600">{h.content.text}</div>
                )}
                <div className="mt-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => removeHighlight(h.id)}>
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </aside>
    </div>
  );
}

export default PdfEditor;


