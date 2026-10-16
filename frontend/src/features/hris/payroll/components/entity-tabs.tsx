"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePayrollEntities } from "../queries";
import type { PayrollEntity } from "../types";

/**
 * Entitas aktif halaman, dibaca dari `?entity=` (default: entitas pertama),
 * sama dengan pola `?run=` di Biaya Gaji per Toko: pilihan bertahan saat
 * reload dan link bisa dibagikan. Nilai yang bukan entitas aktif (mis. link
 * lama `?entity=legacy`) jatuh ke entitas pertama.
 */
export function useEntityParam() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const entitiesQuery = usePayrollEntities();
  const entities = entitiesQuery.data ?? [];
  const requested = params.get("entity") ?? "";
  const entity = entities.some((e) => e.id === requested) ? requested : (entities[0]?.id ?? "");
  const setEntity = (value: string) => router.replace(`${pathname}?entity=${value}`);
  return { entity, setEntity, entities, loading: entitiesQuery.isLoading, error: entitiesQuery.isError };
}

/**
 * Pilihan entitas sebagai pill tabs (kit `Tabs`), bukan popup. Tab hanya berisi
 * entitas; data yang tidak milik satu entitas (run gabungan, gaji tanpa entitas)
 * tampil di kartu terpisah, bukan sebagai tab.
 */
export function EntityTabs({
  value,
  entities,
  onChange,
}: {
  value: string;
  entities: PayrollEntity[];
  onChange: (value: string) => void;
}) {
  if (entities.length === 0) return null;
  return (
    <Tabs value={value} onValueChange={(v) => onChange(String(v))}>
      <TabsList aria-label="Entitas">
        {entities.map((e) => (
          <TabsTrigger key={e.id} value={e.id} title={e.holding_name}>
            {e.name}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
