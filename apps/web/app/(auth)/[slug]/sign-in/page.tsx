import type { Metadata } from "next";

import { OrganizationSignIn } from "./organization-sign-in";

export const metadata: Metadata = { title: "Sign in · Rasi" };

/**
 * A business's own sign-in link, `/<slug>/sign-in` (US-006, ADR-0012). The
 * slug is generated from the business name at sign-up; the page names the
 * business so staff know they are in the right place.
 */
export default async function OrganizationSignInPage({
  params,
}: PageProps<"/[slug]/sign-in">) {
  const { slug } = await params;
  return <OrganizationSignIn slug={slug} />;
}
