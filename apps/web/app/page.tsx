import { redirect } from "next/navigation";

/** `/` has no content of its own: `/home` decides where the caller belongs. */
export default function Root() {
  redirect("/home");
}
