import type { Metadata } from "next";
import { pickOutlet, TreatmentsPage } from "@/features/site/components/treatments-page";
import { fetchContent, fetchSpaOutlets, fetchSpaTreatments, type Loaded } from "@/features/site/lib/public-api";
import type { PublicTreatment } from "@/features/spa/types";

export const metadata: Metadata = {
  title: "Treatment",
  description: "Menu pijat, refleksi dan perawatan tubuh Mizu beserta durasi dan harga di tiap outlet. Booking online, bayar di outlet.",
};

type Props = { searchParams: Promise<{ outlet?: string | string[] }> };

/** The treatment menu of one outlet (?outlet=<branch id>, default the first). */
export default async function Page({ searchParams }: Props) {
  const { outlet } = await searchParams;
  const [guide, outlets] = await Promise.all([fetchContent("training"), fetchSpaOutlets()]);
  const selected = outlets.ok ? pickOutlet(outlets.data, Array.isArray(outlet) ? outlet[0] : outlet) : null;
  const treatments: Loaded<PublicTreatment[]> = selected ? await fetchSpaTreatments(selected.branch_id) : { ok: true, data: [] };
  return <TreatmentsPage guide={guide} outlets={outlets} selected={selected} treatments={treatments} />;
}
