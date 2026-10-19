import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { ContractsListPage } from "@/features/hris/contracts";
import { parseContractTab } from "@/lib/hris/contract-tabs";

// HRIS → Kontrak: daftar kontrak karyawan yang akan segera berakhir
// (filter rentang/tipe/status + sort per kolom), plus tab karyawan tanpa
// kontrak aktif dan masa percobaan (?tab=, dibuka dari kartu pengingat).
export default async function HrisContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireIamPage(IAM.hrisKepegawaian);
  const { tab } = await searchParams;
  return <ContractsListPage tab={parseContractTab(tab)} />;
}
