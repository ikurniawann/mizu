// src/lib/theme/presets.test.ts
import { describe, expect, it } from "vitest";
import { normalizeHex } from "./palette";
import { DEFAULT_PRESET_ID, getPreset, THEME_PRESETS } from "./presets";

describe("THEME_PRESETS", () => {
  it("defaults to the Paddy preset (Paddy Magenta + Lilac)", () => {
    expect(DEFAULT_PRESET_ID).toBe("paddy");
    const paddy = getPreset(DEFAULT_PRESET_ID);
    expect(paddy).toBeDefined();
    expect(paddy!.label).toBe("Paddy");
    expect(paddy!.primary).toBe("#e3066f");
    expect(paddy!.secondary).toBe("#8b6ae6");
  });
  it("maps legacy stored preset ids (nuhabit, mizu) to Paddy", () => {
    expect(getPreset("mizu")?.id).toBe("paddy");
    expect(getPreset("nuhabit")?.id).toBe("paddy");
  });
  it("has unique ids and valid hex values", () => {
    const ids = new Set<string>();
    for (const p of THEME_PRESETS) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(normalizeHex(p.primary)).toBe(p.primary);
      expect(normalizeHex(p.secondary)).toBe(p.secondary);
    }
  });
  it("returns undefined for unknown id", () => {
    expect(getPreset("nope")).toBeUndefined();
  });
});
