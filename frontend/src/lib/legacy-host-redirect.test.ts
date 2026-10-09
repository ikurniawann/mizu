import { describe, expect, it } from "vitest";
import { legacyRedirectTarget } from "./legacy-host-redirect";

describe("legacyRedirectTarget", () => {
  it("keeps path and query on the mapped public origin", () => {
    const target = legacyRedirectTarget("old.example:443", new URL("https://old.example/booking/spa?outlet=a"), "old.example=https://new.example");
    expect(target?.toString()).toBe("https://new.example/booking/spa?outlet=a");
  });
  it("ignores unmapped hosts and unsafe targets", () => {
    const url = new URL("https://old.example/");
    expect(legacyRedirectTarget("other.example", url, "old.example=https://new.example")).toBeNull();
    expect(legacyRedirectTarget("old.example", url, "old.example=javascript:alert(1)")).toBeNull();
    expect(legacyRedirectTarget("old.example", url, "old.example=https://new.example/phish")).toBeNull();
  });
});
