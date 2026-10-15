import { describe, expect, it } from "vitest";
import {
  DEFAULT_PURCHASING_SETTINGS,
  parseSettingBool,
  poRequiresPr,
  poRequiresPrMessage,
  purchasingSettingsFromStored,
} from "./po-rules";

describe("Pengaturan Pembelian rules", () => {
  it("keeps the old behaviour when nothing is stored", () => {
    expect(purchasingSettingsFromStored({})).toEqual(DEFAULT_PURCHASING_SETTINGS);
    expect(DEFAULT_PURCHASING_SETTINGS).toEqual({ po_requires_pr_raw_material: true, po_requires_pr_product: false });
  });

  it("parses stored flags and ignores unreadable values", () => {
    expect(parseSettingBool("false", true)).toBe(false);
    expect(parseSettingBool(" TRUE ", false)).toBe(true);
    expect(parseSettingBool("maybe", true)).toBe(true);
    expect(parseSettingBool(null, false)).toBe(false);
    expect(
      purchasingSettingsFromStored({ po_requires_pr_raw_material: "false", po_requires_pr_product: "true" })
    ).toEqual({ po_requires_pr_raw_material: false, po_requires_pr_product: true });
  });

  it("applies the rule per module; general POs are never gated", () => {
    const rules = { po_requires_pr_raw_material: false, po_requires_pr_product: true };
    expect(poRequiresPr("raw_material", rules)).toBe(false);
    expect(poRequiresPr("product", rules)).toBe(true);
    expect(poRequiresPr("general", { po_requires_pr_raw_material: true, po_requires_pr_product: true })).toBe(false);
    expect(poRequiresPrMessage("product")).toMatch(/^PO produk/);
    expect(poRequiresPrMessage("raw_material")).toMatch(/^PO bahan baku/);
  });
});
