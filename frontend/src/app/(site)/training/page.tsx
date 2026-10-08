import { redirect } from "next/navigation";

/** The gym's training page; the spa's treatment guide lives on /treatments. */
export default function Page() {
  redirect("/treatments");
}
