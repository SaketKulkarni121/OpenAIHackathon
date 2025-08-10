import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { auth, isFirebaseConfigured } from "@/firebase";
import { AuthForm } from "@/components/AuthForm";
import { CreateProjectCard } from "@/components/projects/CreateProjectDialog";
import { ProjectList } from "@/components/projects/ProjectList";
import { ProjectViewer } from "@/components/projects/ProjectViewer";
import { ToastProvider } from "@/components/ui/toast";

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectName, setActiveProjectName] = useState<string>("");

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) return;
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthChecked(true);
    });
    return () => unsubscribe();
  }, []);

  // no-op: static logo from /public/logo.png

  const initials = useMemo(() => {
    const name = user?.displayName || user?.email || "?";
    return name?.slice(0, 2)?.toUpperCase();
  }, [user]);

  if (!isFirebaseConfigured) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md text-sm text-neutral-600">
          <h1 className="mb-2 text-xl font-semibold text-neutral-900">Configure Firebase</h1>
          <p className="mb-2">Create a <code>.env.local</code> with your Firebase values and restart the dev server:</p>
          <pre className="mb-2 rounded-lg border bg-neutral-50 p-3 text-[12px] leading-5 text-neutral-800">{`VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...`}</pre>
          <p>Firebase Console → Authentication → enable Google and Email/Password, and add your localhost to Authorized domains.</p>
        </div>
      </main>
    );
  }

  if (!authChecked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white px-4 text-neutral-900">
        <div className="text-sm text-neutral-500">Loading...</div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white px-4 text-neutral-900">
        <div className="w-full max-w-md">
          <AuthForm />
        </div>
      </main>
    );
  }

  return (
    <ToastProvider>
      <main className="min-h-screen bg-white text-neutral-900">
        <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
            <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 overflow-hidden rounded-md bg-white">
                <img src="/logo.svg" alt="Logo" className="h-full w-full object-contain p-1 scale-110" />
              </div>
              <span className="text-sm text-neutral-500">{activeProjectId ? "Project" : "Dashboard"}</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                aria-label="Sign out"
                title="Sign out"
                onClick={() => auth && signOut(auth!)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-200 text-sm text-neutral-900 hover:bg-neutral-300 transition-colors"
              >
                {initials}
              </button>
            </div>
          </div>
        </header>
        {activeProjectId ? (
          <div className="w-full max-w-full px-0 py-0 overflow-hidden">
            <ProjectViewer
              projectId={activeProjectId}
              projectName={activeProjectName}
              onBack={() => {
                setActiveProjectId(null);
                setActiveProjectName("");
                setRefreshKey((k) => k + 1);
              }}
            />
          </div>
        ) : (
          <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
            <h1 className="text-2xl font-semibold">Projects</h1>
            <CreateProjectCard onCreated={() => {}} setRefreshKey={setRefreshKey} />
            <ProjectList
              refreshKey={refreshKey}
              onOpenProject={(id, name) => {
                setActiveProjectId(id);
                setActiveProjectName(name);
              }}
            />
          </div>
        )}
      </main>
    </ToastProvider>
  );
}

export default App;
