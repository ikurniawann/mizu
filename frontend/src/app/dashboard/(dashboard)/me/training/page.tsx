import { requireUser } from "@/lib/auth/require-user";
import { MyTrainingPage } from "@/features/spa/components/my-training-page";

export const metadata = { title: "Training Saya" };
export default async function Page() {
  await requireUser();
  return <MyTrainingPage />;
}
