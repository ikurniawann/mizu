import { requireUser } from "@/lib/auth/require-user";
import { MyDayOffPage } from "@/features/spa";

export const metadata = { title: "Jadwal Libur" };

export default async function Page() {
  await requireUser();
  return <MyDayOffPage />;
}
