import { describe, expect, it } from "vitest";
import { dayLabel, groupMySchedule, isNewAssignment, treatmentLabel } from "./my-schedule";
import type { MyScheduleItem } from "./types";

// 2026-10-12 10:00 WIB = 03:00Z
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 7, m)).toISOString();
};

function item(p: Partial<MyScheduleItem> & { id: string; booking_id: string; starts_at: string }): MyScheduleItem {
  return {
    variant_id: "v",
    treatment_name: "Balinese Massage",
    variant_name: "60 menit",
    duration_min: 60,
    price_idr: 185000,
    therapist_id: "t",
    therapist_name: "Ayu",
    status: "assigned",
    started_at: null,
    completed_at: null,
    commission_idr: 18500,
    ends_at: p.starts_at,
    booking_code: `PD-${p.booking_id}`,
    branch_id: "b",
    branch_name: "Paddy Store PVJ",
    customer_name: "Rina",
    booking_status: "assigned",
    payment_status: "unpaid",
    commission_estimated: true,
    notes: "",
    assigned_at: null,
    ...p,
  } as MyScheduleItem;
}

describe("dayLabel", () => {
  it("hari ini, besok, lalu nama hari", () => {
    expect(dayLabel("2026-10-12", "2026-10-12")).toBe("Hari ini");
    expect(dayLabel("2026-10-13", "2026-10-12")).toBe("Besok");
    expect(dayLabel("2026-10-14", "2026-10-12")).toBe("Rabu, 14 Okt");
  });
});

describe("groupMySchedule", () => {
  it("per hari lalu per booking, komisi dijumlah, batal dibuang", () => {
    const days = groupMySchedule(
      [
        item({ id: "1", booking_id: "B", starts_at: at("2026-10-13", "14:00") }),
        item({ id: "2", booking_id: "A", starts_at: at("2026-10-12", "11:00"), commission_estimated: false, status: "completed" }),
        item({ id: "3", booking_id: "A", starts_at: at("2026-10-12", "11:00"), commission_idr: 5000, treatment_name: "Totok Wajah" }),
        item({ id: "4", booking_id: "C", starts_at: at("2026-10-12", "15:00"), booking_status: "cancelled" }),
      ],
      "2026-10-12"
    );
    expect(days.map((d) => [d.label, d.bookings.map((b) => b.booking_code)])).toEqual([
      ["Hari ini", ["PD-A"]],
      ["Besok", ["PD-B"]],
    ]);
    const a = days[0].bookings[0];
    expect(a.items).toHaveLength(2);
    expect(a.commission_idr).toBe(23500);
    expect(a.estimated).toBe(true);
  });
  it("booking urut jam mulai dalam sehari", () => {
    const days = groupMySchedule(
      [item({ id: "1", booking_id: "late", starts_at: at("2026-10-12", "19:00") }), item({ id: "2", booking_id: "early", starts_at: at("2026-10-12", "10:00") })],
      "2026-10-12"
    );
    expect(days[0].bookings.map((b) => b.booking_id)).toEqual(["early", "late"]);
  });
});

describe("isNewAssignment", () => {
  const now = new Date(at("2026-10-12", "10:00"));
  it("ditugaskan < 24 jam lalu", () => {
    expect(isNewAssignment({ assigned_at: at("2026-10-12", "08:00"), booking_status: "assigned" }, now)).toBe(true);
    expect(isNewAssignment({ assigned_at: at("2026-10-10", "08:00"), booking_status: "assigned" }, now)).toBe(false);
    expect(isNewAssignment({ assigned_at: null, booking_status: "assigned" }, now)).toBe(false);
    expect(isNewAssignment({ assigned_at: at("2026-10-12", "08:00"), booking_status: "completed" }, now)).toBe(false);
  });
});

describe("treatmentLabel", () => {
  it("durasi tidak diulang", () => {
    expect(treatmentLabel({ treatment_name: "Totok Wajah", variant_name: "45 menit", duration_min: 45 })).toBe("Totok Wajah — 45 menit");
    expect(treatmentLabel({ treatment_name: "Ritual", variant_name: "Signature", duration_min: 150 })).toBe("Ritual — Signature · 150 menit");
  });
});
