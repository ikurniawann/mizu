import { redirect } from "next/navigation";

/** The gym's franchise inquiry page; not offered by Mizu, so send visitors to the treatment menu. */
export default function Page() {
  redirect("/treatments");
}
