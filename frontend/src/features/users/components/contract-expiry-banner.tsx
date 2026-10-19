"use client";

import { ExclamationTriangleIcon, ClockIcon, DocumentMinusIcon } from "@heroicons/react/24/outline";
import { StatCard } from "@/components/ui/stat-card";
import { CONTRACT_TABS, contractsTabHref, type ContractTab } from "@/lib/hris/contract-tabs";
import { appendNavFrom, persistNavFrom } from "@/lib/iam/nav-context";
import { useExpiringContracts } from "../queries";

/**
 * Pengingat kontrak sebagai kartu ringkas yang bisa diklik: (1) karyawan aktif
 * tanpa kontrak aktif — PKWT wajib tertulis sebelum mulai bekerja (PP 35/2021),
 * (2) kontrak aktif yang berakhir ≤30 hari (termasuk yang terlewat), (3) masa
 * percobaan PKWTT yang berakhir. Klik → tabel lengkapnya di HRIS → Kontrak.
 * `from` (mis. "karyawan") ikut di tautan agar breadcrumb bisa kembali ke asal.
 */

const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
};

export function ContractExpiryBanner({ from }: { from?: string }) {
  const { data } = useExpiringContracts(30);
  if (!data) return null;

  const tabHref = (tab: ContractTab) => (from ? appendNavFrom(contractsTabHref(tab), from) : contractsTabHref(tab));

  const noContract = data.noContract ?? [];
  const urgent = data.contracts.filter((c) => c.days_left <= 14).length;
  const cards = [
    noContract.length > 0 && (
      <StatCard
        key="no-contract"
        tone="danger"
        icon={<DocumentMinusIcon />}
        label="Karyawan aktif tanpa kontrak aktif"
        value={noContract.length}
        unit="orang"
        hint="PKWT wajib tertulis sebelum mulai bekerja (PP 35/2021) · Lihat daftar →"
        href={tabHref(CONTRACT_TABS.noContract)}
      />
    ),
    data.contracts.length > 0 && (
      <StatCard
        key="expiring"
        tone="warning"
        icon={<ExclamationTriangleIcon />}
        label={`Kontrak berakhir dalam ${data.days} hari`}
        value={data.contracts.length}
        unit="kontrak"
        hint={`${urgent > 0 ? `${urgent} dalam 14 hari atau sudah lewat · ` : ""}Lihat daftar →`}
        href={tabHref(CONTRACT_TABS.expiring)}
      />
    ),
    data.probations.length > 0 && (
      <StatCard
        key="probation"
        tone="info"
        icon={<ClockIcon />}
        label={`Masa percobaan berakhir dalam ${data.days} hari`}
        value={data.probations.length}
        unit="orang"
        hint="Lihat daftar →"
        href={tabHref(CONTRACT_TABS.probation)}
      />
    ),
  ].filter(Boolean);

  if (cards.length === 0) return null;
  return (
    <div
      className={`grid gap-3 ${GRID_COLS[cards.length]}`}
      // URL baru belum terbaca saat render pertama navigasi klien; simpan asal dulu.
      onClickCapture={from ? () => persistNavFrom(from) : undefined}
    >
      {cards}
    </div>
  );
}
