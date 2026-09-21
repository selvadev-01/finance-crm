"use client";

import { signUpContract } from "@repo/contracts";
import { FormMessage } from "@repo/ui";
import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "../../../../lib/api-client";
import { AuthCard } from "../../auth-card";
import { SignInForm } from "../../sign-in/sign-in-form";

type Lookup =
  | { status: "loading" }
  | { status: "found"; name: string }
  | { status: "not-found" }
  | { status: "error" };

/** Names the business behind the link, then offers the ordinary sign-in form. */
export function OrganizationSignIn({ slug }: { slug: string }) {
  const [lookup, setLookup] = useState<Lookup>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    api(signUpContract.getOrganizationBySlug, { params: { slug } })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setLookup({ status: "found", name: result.body.name });
        else if (result.status === 404 || result.status === 400)
          setLookup({ status: "not-found" });
        else setLookup({ status: "error" });
      })
      .catch(() => {
        if (!cancelled) setLookup({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <AuthCard
      title={lookup.status === "found" ? lookup.name : "Sign in"}
      description={
        lookup.status === "found"
          ? "Sign in with the email and password your administrator gave you."
          : lookup.status === "loading"
            ? "Finding your business…"
            : "Use the email and password your administrator gave you."
      }
      footer={
        lookup.status === "not-found" ? undefined : (
          <Link
            href="/forgot-password"
            className="font-medium text-accent underline"
          >
            Forgotten your password?
          </Link>
        )
      }
    >
      {lookup.status === "not-found" ? (
        <FormMessage tone="critical">
          No business uses this sign-in link. Check the link, or{" "}
          <Link href="/sign-in" className="font-medium underline">
            sign in without it
          </Link>
          .
        </FormMessage>
      ) : null}
      {lookup.status === "found" ? (
        <SignInForm organizationSlug={slug} />
      ) : lookup.status === "error" ? (
        <SignInForm />
      ) : null}
    </AuthCard>
  );
}
