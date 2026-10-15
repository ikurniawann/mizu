import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { PlacementsPage } from "@/features/hris/placements";

// HRIS → Master Data → Penempatan Karyawan: karyawan per toko (payroll multi-toko).
export default async function HrisPlacementsPage() {
  await requireIamPage([...IAM.hrisPlacements, ...IAM.hrisKepegawaian, ...IAM.settingsUsers]);
  return <PlacementsPage />;
}
