import { describe, expect, it } from "vitest";
import {
  distanceMeters,
  placementRangeLabel,
  placementStatus,
  preferredClockStore,
  shortDateId,
} from "./placements";

describe("placementStatus", () => {
  it("menandai aktif, akan datang, dan berakhir", () => {
    expect(placementStatus({ start_date: "2026-07-01", end_date: null }, "2026-10-15")).toBe("aktif");
    expect(placementStatus({ start_date: "2026-11-01", end_date: null }, "2026-10-15")).toBe("akan_datang");
    expect(placementStatus({ start_date: "2026-01-01", end_date: "2026-10-14" }, "2026-10-15")).toBe("berakhir");
    expect(placementStatus({ start_date: "2026-01-01", end_date: "2026-10-15" }, "2026-10-15")).toBe("aktif");
  });
});

describe("placementRangeLabel", () => {
  it("menulis rentang tanggal Indonesia", () => {
    expect(shortDateId("2026-07-01")).toBe("1 Jul 2026");
    expect(placementRangeLabel({ start_date: "2026-07-01", end_date: null })).toBe("Sejak 1 Jul 2026");
    expect(placementRangeLabel({ start_date: "2026-07-01", end_date: "2026-09-30" })).toBe("1 Jul 2026 – 30 Sep 2026");
  });
});

describe("preferredClockStore", () => {
  const pvj = { branch_id: "pvj", is_primary: true, lat: "-6.888900", lng: "107.596000" };
  const kopo = { branch_id: "kopo", is_primary: false, lat: "-6.946000", lng: "107.592000" };

  it("memilih toko terdekat dari GPS", () => {
    expect(preferredClockStore([pvj, kopo], "pvj", { latitude: -6.947, longitude: 107.593 })).toBe("kopo");
    expect(distanceMeters({ latitude: -6.9, longitude: 107.6 }, { latitude: -6.9, longitude: 107.6 })).toBe(0);
  });

  it("tanpa koordinat atau lokasi memakai penempatan utama", () => {
    const noCoords = [{ ...pvj, lat: null, lng: null }, { ...kopo, lat: null, lng: null }];
    expect(preferredClockStore(noCoords, "pvj", { latitude: -6.947, longitude: 107.593 })).toBe("pvj");
    expect(preferredClockStore([pvj, kopo], null, null)).toBe("pvj");
    expect(preferredClockStore([kopo], "pvj", null)).toBe("kopo");
    expect(preferredClockStore([], "pvj", null)).toBeNull();
  });
});
