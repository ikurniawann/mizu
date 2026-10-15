import { redirect } from "next/navigation";

/** The gym's franchise inquiry page; not offered by Paddy, so send visitors to the Paddy Experience menu. */
export default function Page() {
  redirect("/treatments");
}
