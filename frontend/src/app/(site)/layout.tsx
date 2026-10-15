import type { Metadata } from "next";
import { SiteLayout } from "@/features/site/site-layout";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://paddydev.reddie.id"),
  title: { default: "Paddy — Your Adorable Companion", template: "%s | Paddy" },
  description:
    "Paddy: custom phone case & adorable goods dari Bandung sejak 2016. Paddy Case, Catalogue Case, Paddy Pods, Paddy Bags, Pop Socket dan G-Series Watch. Booking sesi Paddy Experience online, bayar di toko.",
  openGraph: {
    type: "website",
    locale: "id_ID",
    siteName: "Paddy",
    title: "Paddy — Your Adorable Companion",
    description: "Custom phone case & adorable goods dari Bandung. Happy shopping, Paddy Besties!",
    images: [{ url: "/site/photos/paddy-hero.webp", width: 1600, height: 1000, alt: "Koleksi Paddy Case di latar doodle Paddy" }],
  },
  twitter: { card: "summary_large_image", title: "Paddy — Your Adorable Companion", images: ["/site/photos/paddy-hero.webp"] },
};

export const dynamic = "force-dynamic";

export default function PublicSiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <SiteLayout>{children}</SiteLayout>;
}
