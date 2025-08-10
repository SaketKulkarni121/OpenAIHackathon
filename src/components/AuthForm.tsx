import { useState } from "react";
import { signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth, googleProvider, isFirebaseConfigured } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export function AuthForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogle() {
    if (!isFirebaseConfigured || !auth || !googleProvider) return;
    setError(null);
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      setError(err?.message ?? "Google sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!isFirebaseConfigured || !auth) return;
    setError(null);
    setLoading(true);
    try {
      if (mode === "signin") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (displayName) {
          await updateProfile(cred.user, { displayName });
        }
      }
    } catch (err: any) {
      setError(err?.message ?? "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <Card>
        <CardHeader>
          <CardTitle>{mode === "signin" ? "Welcome back" : "Create an account"}</CardTitle>
          <CardDescription className="text-neutral-500">
            {mode === "signin" ? "Sign in to continue" : "Sign up to get started"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleEmailAuth} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" placeholder="Your name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>
          <div className="relative">
            <Separator className="my-4 h-px w-full" />
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white px-2 text-xs text-neutral-500">or</div>
          </div>
          <Button variant="outline" className="w-full" onClick={handleGoogle} disabled={loading}>
            <svg className="mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.156 7.961 3.039l5.657-5.657C34.046 6.168 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.651-.389-3.917z"/><path fill="#FF3D00" d="M6.306 14.691l6.571 4.817C14.655 16.108 18.961 13 24 13c3.059 0 5.842 1.156 7.961 3.039l5.657-5.657C34.046 6.168 29.268 4 24 4 16.318 4 9.229 8.337 6.306 14.691z"/><path fill="#4CAF50" d="M24 44c5.167 0 9.86-1.977 13.409-5.197l-6.19-5.238C29.904 35.091 27.088 36 24 36c-5.203 0-9.619-3.317-11.281-7.944l-6.413 4.943C9.152 40.604 16.028 44 24 44z"/><path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.79 2.231-2.197 4.203-3.999 5.605l.003-.002 6.19 5.238C40.121 35.607 44 30.461 44 24c0-1.341-.138-2.651-.389-3.917z"/></svg>
            Continue with Google
          </Button>
          <p className="text-center text-sm text-neutral-500">
            {mode === "signin" ? (
              <>
                Don't have an account?{" "}
                <button className="text-primary underline-offset-4 hover:underline" onClick={() => setMode("signup")}>Sign up</button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button className="text-primary underline-offset-4 hover:underline" onClick={() => setMode("signin")}>Sign in</button>
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}


