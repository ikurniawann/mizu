import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { SpaWaitlistPage } from "@/features/spa";

export const metadata = { title: "Daftar Tunggu" };

export default async function Page() {
  await requireIamPage(IAM.spaBookings);
  return <SpaWaitlistPage />;
}
