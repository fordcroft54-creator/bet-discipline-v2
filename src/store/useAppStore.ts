import { create } from "zustand";

type AppState = {
  revision: number;
  bump: () => void;
};

export const useAppStore = create<AppState>((set) => ({
  revision: 0,
  bump: () => set((s) => ({ revision: s.revision + 1 })),
}));