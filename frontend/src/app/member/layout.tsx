import type { Metadata, Viewport } from "next";
import { MemberLanguage } from "@/features/member-app/components/member-language";

export const metadata: Metadata = {
  title: "Portal Member — Paddy",
  description: "Check your ARK Coin balance, XP, tier, and transaction history.",
  // PWA "Paddy Member": manifest + ikon di public/member-assets (lolos proxy host member).
  manifest: "/member-assets/manifest.webmanifest",
  applicationName: "Paddy Member",
  appleWebApp: { capable: true, title: "Paddy", statusBarStyle: "default" },
  icons: { icon: "/favicon.ico", apple: "/member-assets/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#fbf5ec",
  viewportFit: "cover",
};

/** Layout portal member: berdiri sendiri, tanpa chrome dashboard internal. */
export default function MemberPortalLayout({ children }: { children: React.ReactNode }) {
  return <MemberLanguage>{children}</MemberLanguage>;
}
