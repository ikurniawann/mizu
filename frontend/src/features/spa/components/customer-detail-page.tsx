"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatTime } from "@/lib/format";
import { spaApi } from "../api";
import { useSetCustomerBan } from "../mutations";
import type { SpaCustomerProfile } from "../types";
import { Pager, TableNote } from "./shared";

const genderLabel = { male: "Laki-laki", female: "Perempuan" };

/** Blokir / buka blokir member (revisi R8). Member tidak diberi tahu; kanal online hanya bilang jadwal tidak tersedia. */
function BanCard({ customer }: { customer: SpaCustomerProfile }) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const ban = useSetCustomerBan(customer.id);
  const banned = Boolean(customer.banned_at);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{banned ? "Member diblokir" : "Blokir member"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {banned
              ? "Buka blokir supaya member bisa booking online lagi."
              : "Member nakal bisa diblokir: website dan bot WhatsApp akan selalu menjawab jadwal tidak tersedia, tanpa menyebut blokir. Booking oleh resepsionis tetap bisa."}
          </p>
        </div>
        {banned ? (
          <Button variant="outline" disabled={ban.isPending} onClick={() => ban.mutate({ banned: false })}>
            Buka blokir
          </Button>
        ) : (
          <Button variant="destructive" disabled={ban.isPending} onClick={() => setOpen((v) => !v)}>
            Blokir member
          </Button>
        )}
      </div>
      {!banned && open && (
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-xs text-muted-foreground">Alasan blokir (wajib, hanya terlihat oleh staf)</span>
            <Textarea className="mt-1" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mis. sering booking lalu tidak datang" />
          </label>
          <div className="flex gap-2">
            <Button variant="destructive" disabled={ban.isPending || !reason.trim()} onClick={() => ban.mutate({ banned: true, reason: reason.trim() }, { onSuccess: () => { setOpen(false); setReason(""); } })}>
              Konfirmasi blokir
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>Batal</Button>
          </div>
        </div>
      )}
      {ban.error && <TableNote tone="danger">{ban.error.message}</TableNote>}
    </Card>
  );
}

export function SpaCustomerDetailPage({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const detail = useQuery({
    queryKey: ["spa", "customer-directory", id, page],
    queryFn: () => spaApi.customerDetail(id, page),
  });
  const customer = detail.data?.customer;
  const history = detail.data?.history ?? [];

  return (
    <div className="space-y-4">
      <Link href="/dashboard/spa/customer" className="text-sm text-brand-text hover:underline">← Kembali ke Customer</Link>
      <PageHeader kicker="Studio · Customer" title={customer?.name || "Detail Customer"} description="Profil pelanggan dan riwayat layanan experience yang selesai." />
      {customer?.banned_at && (
        <TableNote tone="danger">
          Member ini diblokir sejak {formatDate(customer.banned_at)}. Booking lewat website dan WhatsApp selalu dijawab &quot;jadwal tidak tersedia&quot;.
          {customer.banned_reason ? ` Alasan: ${customer.banned_reason}` : ""}
        </TableNote>
      )}
      {detail.isPending ? (
        <div className="space-y-4"><SkeletonTable columns={2} rows={3} /><SkeletonTable columns={5} rows={6} /></div>
      ) : detail.error ? (
        <Card><TableNote tone="danger">{detail.error.message}</TableNote></Card>
      ) : customer ? (
        <>
          <Card className="p-5">
            <h2 className="text-base font-semibold">Profil Customer</h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div><dt className="text-xs text-muted-foreground">Nama</dt><dd className="mt-1 font-medium">{customer.name || "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Nomor HP</dt><dd className="mt-1 font-mono">{customer.phone || "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Gender</dt><dd className="mt-1">{customer.gender ? genderLabel[customer.gender] : "Belum diisi"}</dd></div>
              <div>
                <dt className="text-xs text-muted-foreground">Status member</dt>
                <dd className="mt-1">{customer.banned_at ? <Badge variant="destructive">Diblokir</Badge> : <Badge variant="success">Aktif</Badge>}</dd>
              </div>
            </dl>
          </Card>
          <BanCard customer={customer} />
          <Card className="py-0">
            <div className="px-5 pt-5"><h2 className="text-base font-semibold">Riwayat Layanan</h2><p className="mt-1 text-sm text-muted-foreground">Layanan yang sudah selesai, terbaru lebih dulu.</p></div>
            {history.length === 0 ? (
              <TableNote>Belum ada layanan experience yang selesai.</TableNote>
            ) : (
              <>
                <Table>
                  <TableHeader><TableRow><TableHead>Selesai</TableHead><TableHead>Layanan</TableHead><TableHead>Booking</TableHead><TableHead>Toko</TableHead><TableHead>Crew</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {history.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{formatDate(item.completed_at)} · {formatTime(item.completed_at)}</TableCell>
                        <TableCell><span className="font-medium">{item.treatment_name}</span><span className="block text-xs text-muted-foreground">{item.variant_name}</span></TableCell>
                        <TableCell className="font-mono">{item.booking_code}</TableCell>
                        <TableCell>{item.branch_name}</TableCell>
                        <TableCell>{item.therapist_name || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Pager pagination={detail.data?.pagination} onPage={setPage} disabled={detail.isFetching} itemLabel="treatment" />
              </>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
