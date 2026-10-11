import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { SpaTreatmentCategoriesPage } from "@/features/spa";

export const metadata = { title: "Kategori Treatment Spa" };

export default async function Page() {
  await requireIamPage(IAM.spaCategories);
  return <SpaTreatmentCategoriesPage />;
}
