import { TherapistSchedulePage } from "@/features/spa";
import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";

export const metadata = { title: "Jadwal Shift Terapis" };

export default async function Page() {
  await requireIamPage(IAM.spaTherapists);
  return <TherapistSchedulePage />;
}
