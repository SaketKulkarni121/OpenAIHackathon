import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, getDocs, query, Timestamp, where } from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "@/firebase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type ProjectMeta = {
  id: string;
  name: string;
  createdAt?: Timestamp;
  coverUrl?: string | null;
  ownerUid?: string | null;
};

export function ProjectList({ refreshKey = 0, onOpenProject }: { refreshKey?: number; onOpenProject?: (id: string, name: string) => void }) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!isFirebaseConfigured || !db) return;
      const currentUid = auth?.currentUser?.uid ?? null;
      if (!currentUid) {
        setProjects([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const q = query(collection(db, "projects"), where("ownerUid", "==", currentUid));
        const snap = await getDocs(q);
        const rows: ProjectMeta[] = [];
        snap.forEach((d) => {
          const data = d.data() as { name?: string; createdAt?: Timestamp; coverUrl?: string; ownerUid?: string | null };
          rows.push({ id: d.id, name: data.name ?? "Untitled", createdAt: data.createdAt, coverUrl: data.coverUrl, ownerUid: data.ownerUid ?? null });
        });
        rows.sort((a, b) => {
          const at = a.createdAt?.toMillis?.() ?? 0;
          const bt = b.createdAt?.toMillis?.() ?? 0;
          return bt - at;
        });
        setProjects(rows);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to load projects";
        setError(message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [refreshKey]);

  if (!isFirebaseConfigured || !db) return null;

  const currentUid = auth?.currentUser?.uid ?? null;

  async function handleDelete(projectId: string) {
    if (!db) return;
    const ok = window.confirm("Delete this project? This cannot be undone.");
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "projects", projectId));
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete project");
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-neutral-500">Loading projects...</p>}
      {projects.map((p) => (
        <Card key={p.id} className="overflow-hidden cursor-pointer" onClick={() => onOpenProject?.(p.id, p.name)}>
          <div className="aspect-video bg-neutral-100">
            {p.coverUrl ? (
              <img src={p.coverUrl} alt="Cover" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500">No cover</div>
            )}
          </div>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="font-semibold">{p.name}</h4>
                <p className="text-xs text-neutral-500">
                  {p.createdAt ? p.createdAt.toDate().toLocaleString() : "Pending"}
                </p>
              </div>
              {p.ownerUid && currentUid && p.ownerUid === currentUid && (
                <Button
                  type="button"
                  variant="outline"
                  className="border-red-300 text-red-600 hover:bg-red-50"
                  onClick={(e) => { e.stopPropagation(); void handleDelete(p.id); }}
                >
                  Delete
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}


