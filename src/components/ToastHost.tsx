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
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`rounded-xl border px-4 py-3 text-left text-sm text-white shadow-glow transition hover:opacity-90 ${KIND_STYLES[t.kind]}`}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
