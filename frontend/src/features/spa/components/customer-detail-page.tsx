"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatTime } from "@/lib/format";
import { spaApi } from "../api";
import { Pager, TableNote } from "./shared";

const genderLabel = { male: "Laki-laki", female: "Perempuan" };

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
      <PageHeader kicker="Spa · Customer" title={customer?.name || "Detail Customer"} description="Profil pelanggan dan riwayat treatment spa yang selesai." />
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
            </dl>
          </Card>
          <Card className="py-0">
            <div className="px-5 pt-5"><h2 className="text-base font-semibold">Riwayat Treatment</h2><p className="mt-1 text-sm text-muted-foreground">Treatment yang sudah selesai, terbaru lebih dulu.</p></div>
            {history.length === 0 ? (
              <TableNote>Belum ada treatment spa yang selesai.</TableNote>
            ) : (
              <>
                <Table>
                  <TableHeader><TableRow><TableHead>Selesai</TableHead><TableHead>Treatment</TableHead><TableHead>Booking</TableHead><TableHead>Outlet</TableHead><TableHead>Terapis</TableHead></TableRow></TableHeader>
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
