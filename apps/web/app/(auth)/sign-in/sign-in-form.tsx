"use client";

import { staffContract } from "@repo/contracts";
import {
  Button,
  Checkbox,
  Choice,
  Form,
  FormField,
  FormRootError,
  Input,
} from "@repo/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { api } from "../../../lib/api-client";
import { authClient } from "../../../lib/auth-client";

interface SignInValues {
  email: string;
  password: string;
}

// US-001: on by default — a Junior's phone is their own, and a session that
// ends when the browser closes strands them offline (authentication.md).
const DEFAULT_REMEMBER_ME = true;

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
 *
 * Better Auth's client sends the request, not a contract route, so the form
 * has no schema: the browser checks only that both fields are filled in
 * (ADR-0013 form layer, with `register` rules).
 */
export function SignInForm({
  organizationSlug,
}: {
  organizationSlug?: string;
}) {
  const router = useRouter();
  // Stays set once sign-in succeeded, so the button cannot submit again while
  // the next screen loads.
  const [leaving, setLeaving] = useState(false);
  const [rememberMe, setRememberMe] = useState(DEFAULT_REMEMBER_ME);
  const form = useForm<SignInValues>({
    mode: "onTouched",
    shouldFocusError: true,
    defaultValues: { email: "", password: "" },
  });
  form.register("email", {
    required: "is required",
    validate: (value) => value.includes("@") || "must be an email address",
  });
  form.register("password", { required: "is required" });

  const problem = (message: string) =>
    form.setError("root.server", { type: "server", message });

  async function submit({ email, password }: SignInValues) {
    try {
      const { error } = await authClient.signIn.email({
        email,
        password,
        rememberMe,
      });
      if (!error) {
        if (organizationSlug && !(await belongsTo(organizationSlug))) {
          await authClient.signOut();
          problem(
            "This account belongs to a different business. Use your own business’s sign-in link.",
          );
          return;
        }
        setLeaving(true);
        router.replace("/home");
        return;
      }
      if (error.status === 403 && error.message) {
        problem(error.message);
      } else if (error.status === 401) {
        problem(
          "That email and password don’t match. Check both and try again.",
        );
      } else {
        problem("Sign-in didn’t work just now. Try again in a moment.");
      }
    } catch {
      problem("Could not reach Rasi. Check your connection and try again.");
    }
  }

  const pending = form.formState.isSubmitting || leaving;

  return (
    <Form form={form} onSubmit={submit}>
      <FormRootError />
      <FormField<SignInValues> name="email" label="Email">
        <Input type="email" autoComplete="username" inputMode="email" />
      </FormField>
      <FormField<SignInValues> name="password" label="Password">
        <Input type="password" autoComplete="current-password" />
      </FormField>
      <Choice
        label="Keep me signed in"
        description="For 7 days on this device. Leave it off on a shared phone or computer."
      >
        <Checkbox
          checked={rememberMe}
          onCheckedChange={(checked) => setRememberMe(checked === true)}
        />
      </Choice>
      <Button
        tone="primary"
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className="w-full"
      >
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </Form>
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
