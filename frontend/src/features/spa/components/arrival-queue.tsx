"use client";

import { ListOrdered, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatTime } from "@/lib/format";
import { useAutoAssign } from "../mutations";
import { useArrivalQueue } from "../queries";
import { genderLabel } from "../rules";
import { TableNote } from "./shared";

/**
 * Spa → Book Order → tab Antrian (revisi R3): urutan terapis menurut jam absen
 * masuk hari ini. Booking tanpa pilihan terapis diberikan ke terapis teratas
 * yang kosong & cocok, lalu terapis itu pindah ke belakang (rotasi adil).
 * Otomatis berjalan di hari H tiap 5 menit untuk booking ≤ 3 jam ke depan;
 * tombol di sini memproses seluruh hari sekarang juga.
 */
export function ArrivalQueuePanel({ branchId, date }: { branchId: string; date: string }) {
  const queue = useArrivalQueue(branchId, date);
  const auto = useAutoAssign();
  const run = () =>
    auto.mutate(
      { branchId, date },
      {
        onSuccess: (res) => {
          const n = res.assigned.length;
          toast.success(n ? `${n} booking ditugaskan dari antrian` : "Tidak ada booking yang bisa ditugaskan", {
            description: res.skipped.length ? `${res.skipped.length} booking dilewati: ${res.skipped[0].reason}` : undefined,
          });
        },
        onError: (err) => toast.error("Penugasan otomatis gagal", { description: err.message }),
      },
    );

  if (queue.isLoading) return <Skeleton className="h-64 w-full rounded-card" />;
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          <ListOrdered className="mr-1 inline size-4" />
          Urutan dari jam absen masuk; yang baru dapat booking pindah ke belakang. Berjalan otomatis di hari H untuk booking ≤ 3 jam ke depan.
        </p>
        <Button onClick={run} disabled={auto.isPending || present.length === 0} title={present.length ? undefined : "Belum ada crew yang absen masuk"}>
          <Wand2 /> {auto.isPending ? "Memproses…" : "Tugaskan otomatis sekarang"}
        </Button>
      </div>
      <Card className="py-0">
        {present.length === 0 ? (
          <TableNote>Belum ada crew yang absen masuk pada tanggal ini. Antrian terbentuk begitu crew absen di HRIS.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Crew</TableHead>
                <TableHead>Absen masuk</TableHead>
                <TableHead>Booking hari ini</TableHead>
                <TableHead>Terakhir ditugaskan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {present.map((t) => (
                <TableRow key={t.id} data-testid={`queue-${t.id}`}>
                  <TableCell className="font-semibold tabular-nums">{t.position}</TableCell>
                  <TableCell>
                    <span className="font-medium">{t.full_name}</span>
                    {t.gender ? <span className="ml-2 text-xs text-muted-foreground">{genderLabel(t.gender)}</span> : null}
                    {t.position === 1 ? <Badge variant="accent" className="ml-2">Berikutnya</Badge> : null}
                  </TableCell>
                  <TableCell className="tabular-nums">{t.clock_in ? formatTime(t.clock_in) : "-"}</TableCell>
                  <TableCell className="tabular-nums">{t.assigned_today}</TableCell>
                  <TableCell className="tabular-nums">{t.last_assigned_at ? formatTime(t.last_assigned_at) : <span className="text-muted-foreground">belum</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
