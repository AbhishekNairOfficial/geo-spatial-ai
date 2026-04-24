import { create } from "zustand";
import type { GeoFeature, MapCommand } from "@/lib/llm/types";

export type ViewState = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
};

type MapState = {
  viewState: ViewState;
  features: GeoFeature[];
  mapCommand?: MapCommand;
  setViewState: (v: Partial<ViewState>) => void;
  setFeatures: (features: GeoFeature[]) => void;
  setMapCommand: (cmd: MapCommand | undefined) => void;
};

export const useMapStore = create<MapState>((set) => ({
  viewState: {
    longitude: 10,
    latitude: 20,
    zoom: 1.6,
    pitch: 0,
    bearing: 0,
  },
  features: [],
  mapCommand: undefined,
  setViewState: (v) =>
    set((s) => ({ viewState: { ...s.viewState, ...v } })),
  setFeatures: (features) => set({ features }),
  setMapCommand: (mapCommand) => set({ mapCommand }),
}));
