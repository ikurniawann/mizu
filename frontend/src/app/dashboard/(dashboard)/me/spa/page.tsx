import { requireUser } from "@/lib/auth/require-user";
import { MySpaPage } from "@/features/spa";

export const metadata = { title: "Tugas Terapis" };

export default async function Page() {
  await requireUser();
  return <MySpaPage />;
}
