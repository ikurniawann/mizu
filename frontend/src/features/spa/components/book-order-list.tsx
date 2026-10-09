"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { sortByStart } from "../rules";
import type { BoardItem } from "../types";
import { ItemStatusBadge, TableNote, TimeRange } from "./shared";

/** Book Order — tampilan daftar: semua treatment hari itu, urut jam mulai. */
export function BookOrderList({ items, onOpenItem }: { items: BoardItem[]; onOpenItem: (item: BoardItem) => void }) {
  const rows = sortByStart(items);
  return (
    <Card className="py-0">
      {rows.length === 0 ? (
        <TableNote>Belum ada treatment pada tanggal ini.</TableNote>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Jam</TableHead>
              <TableHead>Pelanggan</TableHead>
              <TableHead>Treatment</TableHead>
              <TableHead>Terapis</TableHead>
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
                </TableCell>
                <TableCell>{item.therapist_name ?? <span className="text-warning">Belum ditugaskan</span>}</TableCell>
                <TableCell>
                  <ItemStatusBadge status={item.status} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Link
                    href={`/dashboard/spa/bookings/${item.booking_id}`}
                    className="font-mono text-brand-text hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {item.booking_code}
                  </Link>
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
