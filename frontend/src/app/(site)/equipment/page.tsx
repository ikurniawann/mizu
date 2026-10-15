import { redirect } from "next/navigation";

/** The gym's equipment sales page; Paddy books studio services here, so send visitors to the menu. */
export default function Page() {
  redirect("/treatments");
}
