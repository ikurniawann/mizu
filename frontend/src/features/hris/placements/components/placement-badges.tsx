"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { placementRangeLabel } from "@/lib/hris/placements";
import type { Placement } from "../types";

/** Chip toko per penempatan; penempatan utama diberi bintang. */
export function PlacementBadges({ placements, className }: { placements: Placement[]; className?: string }) {
  if (placements.length === 0) {
    return <span className="text-xs text-amber-700">Belum ada penempatan</span>;
  }
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {placements.map((p) => (
        <span
          key={p.id}
          title={`${p.branch_name} · ${placementRangeLabel(p)}${p.notes ? ` · ${p.notes}` : ""}`}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
            p.is_primary
              ? "border-primary/30 bg-primary/10 font-medium text-brand-text"
              : "border-gray-200 bg-white text-gray-700"
          )}
        >
          {p.is_primary && <Star className="h-3 w-3 fill-current" aria-label="Penempatan utama" />}
          {p.branch_name}
        </span>
      ))}
    </div>
  );
}
