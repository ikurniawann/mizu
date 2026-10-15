import type { Metadata } from "next";
import { BrandPage } from "@/features/site/components/brand-page";
import { fetchContent } from "@/features/site/lib/public-api";

export const metadata: Metadata = { title: "Tentang Paddy" };

export default async function Page() {
  return <BrandPage brand={await fetchContent("brand")} />;
}
