import { useEffect, useRef, useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// no card imports needed here
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";

type Props = {
  onCreated?: () => void;
  setRefreshKey?: React.Dispatch<React.SetStateAction<number>>;
};

export function CreateProjectCard({ onCreated, setRefreshKey }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coverInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  function handlePickCover() {
    coverInputRef.current?.click();
  }

  function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setCoverFile(file);
    if (coverPreview) URL.revokeObjectURL(coverPreview);
    setCoverPreview(file ? URL.createObjectURL(file) : null);
  }

  async function handleCreate() {
    if (!isFirebaseConfigured || !db) {
      setError("Firebase is not configured");
      return;
    }
    if (!name.trim()) {
      setError("Please enter a project name");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // Convert selected image to a data URL and store directly in Firestore
      let coverDataUrl: string | null = null;
      if (coverFile) {
        const maxBytes = 700 * 1024; // ~700KB to stay under Firestore 1MB per document once base64-encoded
        if (coverFile.size > maxBytes) {
          throw new Error("Image too large. Please choose an image under 700KB.");
        }
        coverDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Failed to read image"));
          reader.readAsDataURL(coverFile);
        });
      }

      await addDoc(collection(db, "projects"), {
        name: name.trim(),
        createdAt: serverTimestamp(),
        coverUrl: coverDataUrl,
        ownerUid: auth?.currentUser?.uid ?? null,
      });

      // Reset and close
      setName("");
      setCoverFile(null);
      if (coverInputRef.current) coverInputRef.current.value = "";
      setCoverPreview(null);
      setOpen(false);
      onCreated?.();
      setRefreshKey?.((k) => k + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to create project";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border-2 border-dashed p-6 text-left transition-colors hover:bg-neutral-50"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100">
            <Plus className="h-5 w-5 text-neutral-700" />
          </div>
          <div>
            <div className="font-semibold">Create a project</div>
            <div className="text-sm text-neutral-500">Add a name and optional cover image</div>
          </div>
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogHeader className="p-4">
          <DialogTitle>Create project</DialogTitle>
        </DialogHeader>
        <DialogContent className="space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="space-y-2">
            <Label htmlFor="pname">Project name</Label>
            <Input id="pname" placeholder="e.g. Tower Renovation" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Cover image (optional)</Label>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 overflow-hidden rounded-lg bg-neutral-100">
                {coverPreview ? (
                  <img src={coverPreview} alt="preview" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-neutral-500">None</div>
                )}
              </div>
              <Button type="button" variant="outline" onClick={handlePickCover}>Choose image</Button>
              <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleCreate} disabled={submitting}>{submitting ? "Creating..." : "Create project"}</Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}


