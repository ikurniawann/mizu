import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { SpaOutletsPage } from "@/features/spa";

export const metadata = { title: "Outlet Spa" };

export default async function Page() {
  await requireIamPage(IAM.spaOutlets);
  return <SpaOutletsPage />;
}
