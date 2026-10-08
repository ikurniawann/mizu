import { redirect } from "next/navigation";

/** The gym's equipment sales page; Mizu sells treatments, so send visitors to the menu. */
export default function Page() {
  redirect("/treatments");
}
