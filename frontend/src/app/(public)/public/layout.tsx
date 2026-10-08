import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hubungi Mizu",
  description: "Kirim permintaan penawaran acara, katering, atau kerja sama ke Mizu.",
};

export default function PublicFormLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
