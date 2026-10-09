"use client";

import { useState } from "react";
import { BookingsPage as ClassBookingsPage } from "../classes/bookings-page";
import { SpaMemberBookingsPage } from "./bookings-page";

export function MemberBookingsHub() {
  const [kind, setKind] = useState<"spa" | "classes">("spa");
  return (
    <div className="space-y-5">
      <div className="flex rounded-xl bg-nh-cream p-1" role="tablist" aria-label="Jenis booking">
        <button type="button" role="tab" aria-selected={kind === "spa"} onClick={() => setKind("spa")}
          className={`flex-1 rounded-lg py-2 text-sm font-bold ${kind === "spa" ? "bg-nh-ink-soft text-white" : "text-nh-muted"}`}>
          Treatment
        </button>
        <button type="button" role="tab" aria-selected={kind === "classes"} onClick={() => setKind("classes")}
          className={`flex-1 rounded-lg py-2 text-sm font-bold ${kind === "classes" ? "bg-nh-ink-soft text-white" : "text-nh-muted"}`}>
          Kelas
        </button>
      </div>
      {kind === "spa" ? <SpaMemberBookingsPage /> : <ClassBookingsPage />}
    </div>
  );
}
