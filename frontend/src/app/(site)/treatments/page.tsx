import type { Metadata } from "next";
import { pickOutlet, TreatmentsPage } from "@/features/site/components/treatments-page";
import { fetchContent, fetchExperienceCatalog, fetchSpaOutlets, fetchSpaTreatments, type Loaded } from "@/features/site/lib/public-api";
import type { PublicTreatment } from "@/features/spa/types";

export const metadata: Metadata = {
  title: "Paddy Experience",
  description: "Paddy Experience — desain custom case HP kamu sendiri: pilih tipe HP, layout 2 atau 3 gambar, stiker dari 16 tema, nama dengan font favorit, dan 11 background. Booking online, cetak di Paddy Store.",
};

type Props = { searchParams: Promise<{ outlet?: string | string[] }> };

/** The treatment menu of one outlet (?outlet=<branch id>, default the first). */
export default async function Page({ searchParams }: Props) {
  const { outlet } = await searchParams;
  const [guide, outlets, experience] = await Promise.all([fetchContent("training"), fetchSpaOutlets(), fetchExperienceCatalog()]);
  const selected = outlets.ok ? pickOutlet(outlets.data, Array.isArray(outlet) ? outlet[0] : outlet) : null;
  const treatments: Loaded<PublicTreatment[]> = selected ? await fetchSpaTreatments(selected.branch_id) : { ok: true, data: [] };
  return <TreatmentsPage guide={guide} outlets={outlets} selected={selected} treatments={treatments} experience={experience} />;
}
