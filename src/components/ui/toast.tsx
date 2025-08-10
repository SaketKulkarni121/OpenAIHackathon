/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type ToastItem = {
  id: string;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  variant?: "default" | "destructive";
  durationMs?: number;
};

type ToastContextValue = {
  toasts: ToastItem[];
  push: (t: Omit<ToastItem, "id">) => string;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Record<string, number>>({});

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timers = timersRef.current;
    if (timers[id]) {
      window.clearTimeout(timers[id]);
      delete timers[id];
    }
  }, []);

  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = String(Math.random()).slice(2);
    const item: ToastItem = { id, durationMs: 6000, ...t };
    setToasts((prev) => [item, ...prev]);
    const timers = timersRef.current;
    timers[id] = window.setTimeout(() => dismiss(id), item.durationMs);
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-3 top-3 z-[100] flex w-[320px] max-w-[calc(100vw-24px)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={[
              "pointer-events-auto rounded-md border p-3 shadow-md bg-white",
              t.variant === "destructive" ? "border-red-200 bg-red-50" : "border-neutral-200",
            ].join(" ")}
            role="status"
            aria-live="polite"
          >
            {t.title && <div className="text-sm font-medium mb-1">{t.title}</div>}
            {t.description && <div className="text-xs text-neutral-700 whitespace-pre-wrap">{t.description}</div>}
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-md border px-2 py-1 text-xs hover:bg-neutral-50"
                onClick={() => dismiss(t.id)}
              >
                Dismiss
              </button>
              {t.actionLabel && t.onAction && (
                <button
                  type="button"
                  className="rounded-md border px-2 py-1 text-xs bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-500"
                  onClick={() => {
                    try { t.onAction?.(); } finally { dismiss(t.id); }
                  }}
                >
                  {t.actionLabel}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return {
    toast: ctx.push,
    dismiss: ctx.dismiss,
  };
}


