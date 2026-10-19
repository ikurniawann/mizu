/**
 * Tab halaman HRIS → Kontrak (`?tab=`): kartu pengingat kontrak di halaman
 * Karyawan & Kontrak membuka tab yang sesuai. Modul biasa (bukan "use client")
 * agar halaman server bisa membaca tab dari searchParams.
 */

export const CONTRACT_TABS = {
  expiring: "akan-berakhir",
  noContract: "tanpa-kontrak",
  probation: "masa-percobaan",
} as const;

export type ContractTab = (typeof CONTRACT_TABS)[keyof typeof CONTRACT_TABS];

const TAB_VALUES: readonly string[] = Object.values(CONTRACT_TABS);

export function contractsTabHref(tab: ContractTab): string {
  return `/dashboard/hris/contracts?tab=${tab}`;
}

/** Tab dari query ?tab=; nilai lain atau kosong = Akan berakhir. */
export function parseContractTab(value: string | string[] | undefined): ContractTab {
  const v = Array.isArray(value) ? value[0] : value;
  return v && TAB_VALUES.includes(v) ? (v as ContractTab) : CONTRACT_TABS.expiring;
}
