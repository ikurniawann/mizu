"use client";

import { ListOrdered } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTime } from "@/lib/format";
import { useArrivalQueue } from "../queries";
import { TableNote } from "./shared";

/**
 * Ringkasan antrian di atas Sheet: kolom Sheet mengikuti urutan prioritas
 * penugasan otomatis yang berotasi setelah terapis mendapat booking.
 * Otomatis berjalan di hari H tiap 5 menit untuk booking ≤ 3 jam ke depan.
 */
export function ArrivalQueuePanel({ branchId, date }: { branchId: string; date: string }) {
  const queue = useArrivalQueue(branchId, date);
  if (queue.isLoading) return <Skeleton className="h-20 w-full rounded-card" />;
  if (queue.error) {
    return (
      <Card className="py-0 shadow-none!">
        <TableNote tone="danger">{queue.error.message}</TableNote>
      </Card>
    );
  }
  const present = queue.data?.queue ?? [];
  const absent = queue.data?.absent ?? [];
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        <ListOrdered className="mr-1 inline size-4" />
        Urutan dari jam absen masuk; yang baru dapat booking pindah ke belakang. Berjalan otomatis di hari H untuk booking ≤ 3 jam ke depan.
      </p>
      <Card className="gap-2 p-3 shadow-none!">
        {present.length === 0 ? (
          <TableNote>Belum ada terapis yang absen masuk pada tanggal ini. Antrian terbentuk begitu terapis absen di HRIS.</TableNote>
        ) : (
          <div className="flex flex-wrap gap-2" aria-label="Prioritas penugasan otomatis">
            {present.map((t) => (
              <Badge key={t.id} variant={t.position === 1 ? "accent" : "muted"} data-testid={`queue-${t.id}`}>
                {t.position}. {t.full_name} · absen {t.clock_in ? formatTime(t.clock_in) : "-"}
              </Badge>
            ))}
          </div>
        )}
      </Card>
      {absent.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Belum absen: {absent.map((t) => t.full_name).join(", ")}. Mereka tidak menerima booking otomatis sampai absen masuk.
        </p>
      )}
    </div>
  );
}
