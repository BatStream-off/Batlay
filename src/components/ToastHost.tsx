import { X } from "lucide-react";
import { useToastStore } from "@/stores/useToastStore";

const KIND_STYLES: Record<string, string> = {
  info: "border-base-600 bg-base-800",
  success: "border-live/40 bg-base-800",
  error: "border-red-500/40 bg-base-800",
};

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    // aria-live : les lecteurs d'écran annoncent les confirmations sans que le focus bouge.
    <div role="status" aria-live="polite" className="fixed bottom-6 right-6 z-50 flex max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          title="Fermer"
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm leading-snug text-fg shadow-glow transition hover:opacity-90 ${KIND_STYLES[t.kind]}`}
        >
          <span className="min-w-0 flex-1">{t.message}</span>
          <X size={14} className="mt-0.5 shrink-0 text-faint" />
        </button>
      ))}
    </div>
  );
}
