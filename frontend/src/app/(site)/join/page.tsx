import { redirect } from "next/navigation";

/** The gym's membership checkout; spa guests book a treatment instead. */
export default function Page() {
  redirect("/booking/spa");
}
