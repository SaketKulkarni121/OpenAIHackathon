import { useEffect, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Plus, FileText, ChevronsLeft, ChevronsRight } from "lucide-react";
import { PdfEditor } from "@/components/projects/PdfEditor";

type PdfItem = {
  id: string;
  name: string;
  createdAt?: Timestamp;
  numChunks?: number;
  size?: number;
  mimeType?: string;
};

export function ProjectViewer({ projectId, projectName, onBack }: { projectId: string; projectName: string; onBack: () => void }) {
  const [pdfs, setPdfs] = useState<PdfItem[]>([]);
  const [selectedPdfId, setSelectedPdfId] = useState<string | null>(null);
  const [selectedPdfUrl, setSelectedPdfUrl] = useState<string | null>(null);
  const prevObjectUrlRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    async function load() {
      if (!isFirebaseConfigured || !db) return;
      setLoading(true);
      setError(null);
      try {
        const q = query(collection(db, "projects", projectId, "pdfs"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        const rows: PdfItem[] = [];
        snap.forEach((d) => {
          const data = d.data() as { name?: string; createdAt?: Timestamp; numChunks?: number; size?: number; mimeType?: string };
          if (data.name) rows.push({ id: d.id, name: data.name, createdAt: data.createdAt, numChunks: data.numChunks, size: data.size, mimeType: data.mimeType });
        });
        setPdfs(rows);
        if (rows.length > 0) {
          selectPdf(rows[0]);
        } else {
          setSelectedPdfId(null);
          setSelectedPdfUrl(null);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to load PDFs";
        setError(message);
      } finally {
        setLoading(false);
      }
    }
    load();
    // selectPdf is stable within this effect's lifecycle and not needed as a dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function selectPdf(item: PdfItem) {
    if (!db) return;
    setSelectedPdfId(item.id);
    setError(null);
    try {
      const chunksSnap = await getDocs(query(collection(db, "projects", projectId, "pdfs", item.id, "chunks"), orderBy("index", "asc")));
      const parts: string[] = [];
      chunksSnap.forEach((d) => {
        const data = d.data() as { index: number; data: string };
        if (data?.data) parts.push(data.data);
      });
      if (parts.length === 0) {
        setSelectedPdfUrl(null);
        return;
      }
      const base64 = parts.join("");
      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: item.mimeType || "application/pdf" });
      if (prevObjectUrlRef.current) URL.revokeObjectURL(prevObjectUrlRef.current);
      const url = URL.createObjectURL(blob);
      prevObjectUrlRef.current = url;
      setSelectedPdfUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load PDF");
    }
  }

  async function handleDeleteSelectedPdf() {
    if (!db || !selectedPdfId) return;
    const ok = window.confirm("Delete this PDF and its data?");
    if (!ok) return;
    try {
      // Delete all chunks
      const chunksSnap = await getDocs(collection(db!, "projects", projectId, "pdfs", selectedPdfId, "chunks"));
      const deletions: Promise<unknown>[] = [];
      chunksSnap.forEach((d) => {
        deletions.push(deleteDoc(doc(db!, "projects", projectId, "pdfs", selectedPdfId, "chunks", d.id)));
      });
      // Delete annotations doc
      deletions.push(deleteDoc(doc(db!, "projects", projectId, "pdfs", selectedPdfId, "annotations", "default")));
      await Promise.allSettled(deletions);
      // Delete the pdf doc itself
      await deleteDoc(doc(db!, "projects", projectId, "pdfs", selectedPdfId));
      setPdfs((prev) => prev.filter((p) => p.id !== selectedPdfId));
      setSelectedPdfId(null);
      if (prevObjectUrlRef.current) URL.revokeObjectURL(prevObjectUrlRef.current);
      setSelectedPdfUrl(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete PDF");
    }
  }

  function handlePickPdf() {
    fileInputRef.current?.click();
  }

  async function handleAddPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type || !file.type.includes("pdf")) {
      setError("Please select a PDF file");
      return;
    }
    if (!isFirebaseConfigured || !db) {
      setError("Firebase is not configured");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // Read file into base64 string
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      // Chunk into Firestore-sized pieces
      const CHUNK_SIZE = 500_000; // 500KB of base64 text per doc for safety under 1MB limit
      const numChunks = Math.ceil(base64.length / CHUNK_SIZE);

      const docRef = await addDoc(collection(db, "projects", projectId, "pdfs"), {
        name: file.name,
        createdAt: serverTimestamp(),
        ownerUid: auth?.currentUser?.uid ?? null,
        numChunks,
        size: file.size,
        mimeType: file.type || "application/pdf",
      });

      for (let i = 0; i < numChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(base64.length, start + CHUNK_SIZE);
        const chunk = base64.slice(start, end);
        const chunkId = i.toString().padStart(6, "0");
        await setDoc(doc(db, "projects", projectId, "pdfs", docRef.id, "chunks", chunkId), {
          index: i,
          data: chunk,
        });
      }

      const newItem: PdfItem = { id: docRef.id, name: file.name, numChunks, size: file.size, mimeType: file.type || "application/pdf" };
      setPdfs((prev) => [newItem, ...prev]);
      await selectPdf(newItem);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload PDF");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-56px)] w-full max-w-full overflow-hidden min-w-0">
      {/* Sidebar */}
      <aside className={`${sidebarCollapsed ? "w-14" : "w-64"} shrink-0 border-r bg-white transition-all flex flex-col`}>
        <div className="flex h-12 items-center justify-between px-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handlePickPdf}
            className="gap-2"
            title="Add PDF"
          >
            <Plus className="h-4 w-4" />
            {!sidebarCollapsed && <span>Add PDF</span>}
          </Button>
          <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleAddPdf} />
        </div>
        <div className="border-t" />
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {pdfs.map((p) => (
            <button
              key={p.id}
              onClick={() => selectPdf(p)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-neutral-100 ${
                selectedPdfId === p.id ? "bg-neutral-100" : ""
              }`}
              title={p.name}
            >
              <FileText className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed && <span className="truncate">{p.name}</span>}
            </button>
          ))}
          {!loading && pdfs.length === 0 && (
            <div className="px-2 py-2 text-xs text-neutral-500">No PDFs yet</div>
          )}
          {loading && <div className="px-2 py-2 text-xs text-neutral-500">Loading...</div>}
          {error && <div className="px-2 py-2 text-xs text-red-600">{error}</div>}
        </div>
        <div className="border-t">
          <div className="flex items-center justify-center p-2">
            <button
              aria-label="Toggle sidebar"
              className="rounded-md p-1 hover:bg-neutral-100"
              onClick={() => setSidebarCollapsed((c) => !c)}
              title={sidebarCollapsed ? "Expand" : "Collapse"}
            >
              {sidebarCollapsed ? <ChevronsRight className="h-5 w-5" /> : <ChevronsLeft className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </aside>

      {/* Main viewer */}
      <div className="flex min-h-[calc(100vh-56px)] w-full flex-1 flex-col overflow-hidden min-w-0">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onBack}>
              Back to projects
            </Button>
            <span className="text-sm text-neutral-500">{projectName}</span>
          </div>
          <div className="flex items-center gap-2">
            {selectedPdfId && (
              <Button type="button" variant="outline" size="sm" className="border-red-300 text-red-600 hover:bg-red-50" onClick={handleDeleteSelectedPdf}>
                Delete PDF
              </Button>
            )}
          </div>
        </div>
        <div className="flex-1 bg-neutral-50 w-full max-w-full overflow-hidden min-w-0 relative z-0">
          {selectedPdfUrl && selectedPdfId ? (
            <PdfEditor projectId={projectId} pdfId={selectedPdfId} url={selectedPdfUrl} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-neutral-500">Select a PDF to view</div>
          )}
        </div>
      </div>
    </div>
  );
}


