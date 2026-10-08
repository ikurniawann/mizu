import type { Metadata } from "next";
import { SiteLayout } from "@/features/site/site-layout";

export const metadata: Metadata = {
  title: { default: "Mizu", template: "%s | Mizu" },
  description: "Mizu Family Massage & Reflexology di Bandung: pijat, refleksi dan perawatan tubuh. Rest, relax, rejuvenate. Booking online, bayar di outlet.",
};

export const dynamic = "force-dynamic";

export default function PublicSiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <SiteLayout>{children}</SiteLayout>;
}
