"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { spaApi } from "../api";
import { Pager, TableNote } from "./shared";

const genderLabel = { male: "Laki-laki", female: "Perempuan" };

export function SpaCustomersPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebouncedValue(q.trim(), 300);
  const customers = useQuery({
    queryKey: ["spa", "customer-directory", search, page],
    queryFn: () => spaApi.customerDirectory({ q: search || undefined, page, limit: 20 }),
    placeholderData: keepPreviousData,
  });
  const rows = customers.data?.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader kicker="Spa" title="Customer" description="Daftar pelanggan yang tersedia untuk pencarian saat membuat booking spa." />
      <Input
        value={q}
        onChange={(event) => { setQ(event.target.value); setPage(1); }}
        placeholder="Cari nama atau nomor HP"
        aria-label="Cari customer"
        className="max-w-md"
      />
      <Card className="py-0">
        {customers.isPending ? (
          <div className="p-4"><SkeletonTable columns={3} rows={8} /></div>
        ) : customers.error ? (
          <TableNote tone="danger">{customers.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Customer tidak ditemukan.</TableNote>
        ) : (
          <>
            <Table>
              <TableHeader><TableRow><TableHead>Nama</TableHead><TableHead>Nomor HP</TableHead><TableHead>Gender</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((customer) => (
                  <TableRow key={customer.id} className={customers.isPlaceholderData ? "opacity-60" : undefined}>
                    <TableCell className="font-medium">
                      <Link href={`/dashboard/spa/customer/${customer.id}`} className="text-brand-text hover:underline">
                        {customer.name || "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono">{customer.phone || "—"}</TableCell>
                    <TableCell>{customer.gender ? genderLabel[customer.gender] : "Belum diisi"}</TableCell>
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
