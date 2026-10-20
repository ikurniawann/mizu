import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { SpaCommissionsPage } from "@/features/spa";

export const metadata = { title: "Laporan Komisi" };

export default async function Page() {
  await requireIamPage(IAM.spaCommissions);
  return <SpaCommissionsPage />;
}
