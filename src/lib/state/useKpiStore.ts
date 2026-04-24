import { create } from "zustand";
import type { Kpi } from "@/lib/llm/types";

type KpiState = {
  kpis: Kpi[];
  setKpis: (kpis: Kpi[]) => void;
};

export const useKpiStore = create<KpiState>((set) => ({
  kpis: [],
  setKpis: (kpis) => set({ kpis }),
}));
