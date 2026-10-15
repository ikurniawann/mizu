"use client";

import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { sortByStart } from "../rules";
import type { BoardItem } from "../types";
import { ItemStatusBadge, TableNote, TimeRange } from "./shared";
import { CaseThumb } from "./case-design/case-preview";
import { CaseDesignBadge } from "./case-design/case-design-card";

/** Book Order — tampilan daftar: semua treatment hari itu, urut jam mulai. */
export function BookOrderList({
  items,
  onOpenItem,
  onDesign,
}: {
  items: BoardItem[];
  onOpenItem: (item: BoardItem) => void;
  /** Buka dialog desain custom case (layanan customizable). */
  onDesign?: (item: BoardItem) => void;
}) {
  const rows = sortByStart(items);
  return (
    <Card className="py-0 shadow-none!">
      {rows.length === 0 ? (
        <TableNote>Belum ada layanan pada tanggal ini.</TableNote>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Jam</TableHead>
              <TableHead>Pelanggan</TableHead>
              <TableHead>Layanan</TableHead>
              <TableHead>Crew</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Booking</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Harga</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((item) => (
              <TableRow
                key={item.id}
                className={cn("cursor-pointer", item.status === "cancelled" && "opacity-50")}
                onClick={() => onOpenItem(item)}
              >
                <TableCell>
                  <TimeRange start={item.starts_at} end={item.ends_at} className="font-medium" />
                </TableCell>
                <TableCell className="font-medium">{item.customer_name}</TableCell>
                <TableCell className="whitespace-normal">
                  <p>{item.treatment_name}</p>
                  <p className="text-xs text-muted-foreground">{item.variant_name}</p>
                  {item.customizable && (
                    <button
                      type="button"
                      className="mt-1 flex items-center gap-2 text-left"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDesign?.(item);
                      }}
                    >
                      {item.design ? <CaseThumb design={item.design} className="w-6" /> : null}
                      <span>
                        <CaseDesignBadge design={item.design} />
                        {item.design ? <span className="block text-[11px] text-muted-foreground">{item.design.model}</span> : null}
                      </span>
                    </button>
                  )}
                </TableCell>
                <TableCell>{item.therapist_name ?? <span className="text-warning">Belum ditugaskan</span>}</TableCell>
                <TableCell>
                  <ItemStatusBadge status={item.status} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <button
                    type="button"
                    className="font-mono text-brand-text hover:underline"
                    onClick={(e) => { e.stopPropagation(); onOpenItem(item); }}
                  >
                    {item.booking_code}
                  </button>
                </TableCell>
                <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatRupiah(item.price_idr)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
