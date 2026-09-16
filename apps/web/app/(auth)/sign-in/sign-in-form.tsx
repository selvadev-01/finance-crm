"use client";

import { staffContract } from "@repo/contracts";
import { Button, Field, FormMessage, Input } from "@repo/ui";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { api } from "../../../lib/api-client";
import { authClient } from "../../../lib/auth-client";

/**
 * US-001 sign-in, and a business's own sign-in link (US-006).
 *
 * The API decides what each refusal says (M01 as built): a wrong email or
 * password is one message, whichever was wrong; a suspended or inactive
 * account gets the server's own "cannot sign in" message, shown as returned so
 * the wording lives in one place.
 *
 * Opened from `/<slug>/sign-in`, it also checks the account belongs to that
 * business, and signs a staff member of another business straight back out.
 * That keeps people on their own link; it is not access control — every
 * request is still scoped to the caller's own organization by the API (M02).
 */
export function SignInForm({
  organizationSlug,
}: {
  organizationSlug?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setProblem(null);

    try {
      const { error } = await authClient.signIn.email({
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
      if (!error) {
        if (organizationSlug && !(await belongsTo(organizationSlug))) {
          await authClient.signOut();
          setProblem(
            "This account belongs to a different business. Use your own business’s sign-in link.",
          );
          setPending(false);
          return;
        }
        router.replace("/home");
        return;
      }
      if (error.status === 403 && error.message) {
        setProblem(error.message);
      } else if (error.status === 401) {
        setProblem(
          "That email and password don’t match. Check both and try again.",
        );
      } else {
        setProblem("Sign-in didn’t work just now. Try again in a moment.");
      }
    } catch {
      setProblem("Could not reach Rasi. Check your connection and try again.");
    }
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-[var(--stack-gap)]">
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <Field label="Email">
        <Input
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          disabled={pending}
        />
      </Field>
      <Field label="Password">
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
        />
      </Field>
      <Button
        tone="primary"
        type="submit"
        disabled={pending}
        className="w-full"
      >
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

/**
 * Whether the signed-in account works for the business behind the link. A
 * pending forced password change answers `403` here; that account is let
 * through to `/home`, which sends it to change its password first.
 */
async function belongsTo(slug: string): Promise<boolean> {
  const result = await api(staffContract.me, {});
  if (!result.ok) return true;
  return result.body.organization.slug === slug;
}
