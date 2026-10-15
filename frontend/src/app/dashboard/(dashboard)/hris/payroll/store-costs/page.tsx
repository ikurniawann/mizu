import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { StoreCostReportPage } from "@/features/hris/payroll";

// HRIS → Penggajian → Biaya Gaji per Toko (payroll multi-toko).
export default async function HrisPayrollStoreCostsPage() {
  await requireIamPage(IAM.hrisCompensation);
  return <StoreCostReportPage />;
}
