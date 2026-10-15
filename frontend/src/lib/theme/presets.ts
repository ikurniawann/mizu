// src/lib/theme/presets.ts
export type ThemePreset = {
  id: string;
  label: string;
  primary: string;
  secondary: string;
};

export const DEFAULT_PRESET_ID = "paddy";

export const THEME_PRESETS: readonly ThemePreset[] = [
  { id: "paddy", label: "Paddy", primary: "#e3066f", secondary: "#8b6ae6" },
  { id: "lime", label: "Lime", primary: "#daff59", secondary: "#00281a" },
  { id: "wonderland", label: "Biru", primary: "#1d1dcc", secondary: "#2941d3" },
  { id: "ocean", label: "Ocean", primary: "#0ea5e9", secondary: "#6366f1" },
  { id: "emerald", label: "Emerald", primary: "#10b981", secondary: "#14b8a6" },
  { id: "graphite", label: "Graphite", primary: "#334155", secondary: "#64748b" },
  { id: "sunset", label: "Sunset", primary: "#f97316", secondary: "#ef4444" },
] as const;

/** Preset id lama yang mungkin masih tersimpan di browser (NüHabit, lalu Mizu) → Paddy. */
const LEGACY_PRESET_IDS: Record<string, string> = { nuhabit: "paddy", mizu: "paddy" };

export function getPreset(id: string): ThemePreset | undefined {
  const resolved = LEGACY_PRESET_IDS[id] ?? id;
  return THEME_PRESETS.find((p) => p.id === resolved);
}
