import { requireIamPage } from "@/lib/auth/require-user";
import { SpaBookingDetailPage } from "@/features/spa";

export const metadata = { title: "Detail Booking History" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireIamPage(["spa.bookings"]);
  const { id } = await params;
  return <SpaBookingDetailPage id={id} readOnly />;
}
