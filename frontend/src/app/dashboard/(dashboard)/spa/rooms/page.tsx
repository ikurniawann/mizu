import { SpaRoomsPage } from "@/features/spa";
import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";

export const metadata = { title: "Room Spa" };

export default async function Page() {
  await requireIamPage(IAM.spaRooms);
  return <SpaRoomsPage />;
}
