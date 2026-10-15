"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePayrollEntities } from "../queries";
import type { PayrollEntity } from "../types";

/** Tab di luar daftar entitas, mis. "Run lama" atau "Belum ada entitas". */
export interface ExtraEntityTab {
  value: string;
  label: string;
}

/**
 * Entitas aktif halaman, dibaca dari `?entity=` (default: entitas pertama),
 * sama dengan pola `?run=` di Biaya Gaji per Toko: pilihan bertahan saat
 * reload dan link bisa dibagikan.
 */
export function useEntityParam(extra: ExtraEntityTab[] = []) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const entitiesQuery = usePayrollEntities();
  const entities = entitiesQuery.data ?? [];
  const requested = params.get("entity") ?? "";
  const known = entities.some((e) => e.id === requested) || extra.some((x) => x.value === requested);
  const entity = known ? requested : (entities[0]?.id ?? extra[0]?.value ?? "");
  const setEntity = (value: string) => router.replace(`${pathname}?entity=${value}`);
  return { entity, setEntity, entities, loading: entitiesQuery.isLoading, error: entitiesQuery.isError };
}

/** Pilihan entitas sebagai pill tabs (kit `Tabs`), bukan popup. */
export function EntityTabs({
  value,
  entities,
  extra = [],
  onChange,
}: {
  value: string;
  entities: PayrollEntity[];
  extra?: ExtraEntityTab[];
  onChange: (value: string) => void;
}) {
  if (entities.length === 0 && extra.length === 0) return null;
  return (
    <Tabs value={value} onValueChange={(v) => onChange(String(v))}>
      <TabsList aria-label="Entitas">
        {entities.map((e) => (
          <TabsTrigger key={e.id} value={e.id} title={e.holding_name}>
            {e.name}
          </TabsTrigger>
        ))}
        {extra.map((x) => (
          <TabsTrigger key={x.value} value={x.value}>
            {x.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
