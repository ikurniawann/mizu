import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Careers | Paddy",
  description:
    "Explore open roles and apply to join the Paddy team.",
};

export default function CareerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
