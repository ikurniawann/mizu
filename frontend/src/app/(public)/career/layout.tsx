import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Careers | Mizu",
  description:
    "Explore open roles and apply to join the Mizu team.",
};

export default function CareerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
