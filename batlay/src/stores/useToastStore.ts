import { create } from "zustand";
import { nanoid } from "nanoid";

export interface Toast {
  id: string;
  message: string;
  kind: "info" | "success" | "error";
}

interface ToastStoreState {
  toasts: Toast[];
  push: (message: string, kind?: Toast["kind"]) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastStoreState>((set, get) => ({
  toasts: [],
  push: (message, kind = "info") => {
    const id = nanoid(6);
    set({ toasts: [...get().toasts, { id, message, kind }] });
    setTimeout(() => get().dismiss(id), 4000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
