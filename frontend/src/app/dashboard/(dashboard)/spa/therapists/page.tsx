import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { SpaTherapistsPage } from "@/features/spa";

export const metadata = { title: "Terapis Spa" };

export default async function Page() {
  await requireIamPage(IAM.spaTherapists);
  return <SpaTherapistsPage />;
}
