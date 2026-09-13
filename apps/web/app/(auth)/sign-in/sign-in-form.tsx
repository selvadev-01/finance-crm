"use client";

import { Button, Field, FormMessage, Input } from "@repo/ui";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { authClient } from "../../../lib/auth-client";

/**
 * US-001 sign-in.
 *
 * The API decides what each refusal says (M01 as built): a wrong email or
 * password is one message, whichever was wrong; a suspended or inactive
 * account gets the server's own "cannot sign in" message, shown as returned so
 * the wording lives in one place.
 */
export function SignInForm() {
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
