import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { SpaTreatmentsPage } from "@/features/spa";

export const metadata = { title: "Treatment Spa" };

export default async function Page() {
  await requireIamPage(IAM.spaTreatments);
  return <SpaTreatmentsPage />;
}
