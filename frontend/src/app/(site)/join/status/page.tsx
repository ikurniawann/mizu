import { redirect } from "next/navigation";

/** The gym's membership purchase status; spa guests book a treatment instead. */
export default function Page() {
  redirect("/booking/spa");
}
