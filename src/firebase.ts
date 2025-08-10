// Import the functions you need from the SDKs you need
import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

// Config via Vite env vars. Create a .env file with these keys.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.appId,
].every(Boolean);

let app: FirebaseApp | undefined;
let authInstance: Auth | undefined;
let dbInstance: Firestore | undefined;
let storageInstance: FirebaseStorage | undefined;
let googleProviderInstance: GoogleAuthProvider | undefined;

try {
  app = initializeApp(firebaseConfig);
  authInstance = getAuth(app);
  dbInstance = getFirestore(app);
  googleProviderInstance = new GoogleAuthProvider();

  // Accept a variety of bucket formats and normalize to `gs://<project-id>.appspot.com`.
  function deriveBucketUrl(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    let candidate = raw.trim();

    // If it's a gs URL
    if (candidate.startsWith("gs://")) {
      candidate = candidate.replace(/^gs:\/\//, "");
    }

    // If it's an http(s) URL, try to extract the bucket segment
    if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
      try {
        const url = new URL(candidate);
        // Typical pattern: https://firebasestorage.googleapis.com/v0/b/<bucket>/o
        const parts = url.pathname.split("/").filter(Boolean);
        const bIndex = parts.findIndex((p) => p === "b");
        if (bIndex >= 0 && parts[bIndex + 1]) {
          candidate = parts[bIndex + 1];
        } else {
          // Fallback to hostname when possible
          candidate = url.hostname;
        }
      } catch {
        return undefined;
      }
    }

    // Remove any path segments if present
    candidate = candidate.split("/")[0];

    // Normalize old domain to the expected appspot.com form
    candidate = candidate.replace(".firebasestorage.app", ".appspot.com");

    // If only projectId is provided, append appspot.com
    if (!candidate.includes(".") && firebaseConfig.projectId && candidate === firebaseConfig.projectId) {
      candidate = `${candidate}.appspot.com`;
    }

    // Basic sanity check
    if (!candidate.endsWith(".appspot.com")) return undefined;
    return `gs://${candidate}`;
  }

  const rawBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined;
  const bucketUrl = deriveBucketUrl(rawBucket);

  // If we can derive a valid bucket URL, use it; otherwise fall back to the default bucket
  storageInstance = bucketUrl ? getStorage(app, bucketUrl) : getStorage(app);
} catch {
  // Swallow init errors so the UI can show setup instructions
}

export const auth = authInstance;
export const db = dbInstance;
export const googleProvider = googleProviderInstance;
export const storage = storageInstance;
