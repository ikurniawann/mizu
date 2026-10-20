"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { spaApi } from "../api";
import { Pager, SELECT, TableNote } from "./shared";

const genderLabel = { male: "Laki-laki", female: "Perempuan" };

export function SpaCustomersPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "blocked" | "unblocked">("");
  const [page, setPage] = useState(1);
  const search = useDebouncedValue(q.trim(), 300);
  const customers = useQuery({
    queryKey: ["spa", "customer-directory", search, status, page],
    queryFn: () => spaApi.customerDirectory({ q: search || undefined, status: status || undefined, page, limit: 20 }),
    placeholderData: keepPreviousData,
  });
  const rows = customers.data?.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader kicker="Spa" title="Customer" description="Daftar pelanggan yang tersedia untuk pencarian saat membuat booking spa." />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,28rem)_12rem]">
        <Input
          value={q}
          onChange={(event) => { setQ(event.target.value); setPage(1); }}
          placeholder="Cari nama atau nomor HP"
          aria-label="Cari customer"
        />
        <select className={SELECT} value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }} aria-label="Status customer">
          <option value="">Semua status</option>
          <option value="blocked">Diblokir</option>
          <option value="unblocked">Tidak diblokir</option>
        </select>
      </div>
      <Card className="py-0">
        {customers.isPending ? (
          <div className="p-4"><SkeletonTable columns={4} rows={8} /></div>
        ) : customers.error ? (
          <TableNote tone="danger">{customers.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Customer tidak ditemukan.</TableNote>
        ) : (
          <>
            <Table>
              <TableHeader><TableRow><TableHead>Nama</TableHead><TableHead>Nomor HP</TableHead><TableHead>Gender</TableHead><TableHead className="text-right">Aksi</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((customer) => (
                  <TableRow key={customer.id} className={customers.isPlaceholderData ? "opacity-60" : undefined}>
                    <TableCell className="font-medium">
                      {customer.name || "—"}
                      {customer.banned && <Badge variant="destructive" className="ml-2">Diblokir</Badge>}
                    </TableCell>
                    <TableCell className="font-mono">{customer.phone || "—"}</TableCell>
                    <TableCell>{customer.gender ? genderLabel[customer.gender] : "Belum diisi"}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/dashboard/spa/customer/${customer.id}`} aria-label={`Detail customer ${customer.name || "tanpa nama"}`}>Detail</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager pagination={customers.data?.pagination} onPage={setPage} disabled={customers.isFetching} itemLabel="customer" />
          </>
        )}
      </Card>
    </div>
  );
}
