"use client";

import { signUpContract } from "@repo/contracts";
import { Button, Field, FormMessage, Input } from "@repo/ui";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { apiWrite } from "../../../lib/api-write";
import { authClient } from "../../../lib/auth-client";

type FieldName = "organizationName" | "name" | "email" | "phone" | "password";

const LABELS: Record<FieldName, string> = {
  organizationName: "Business name",
  name: "Your name",
  email: "Email",
  phone: "Mobile number",
  password: "Password",
};

interface Created {
  slug: string;
  /** Whether the automatic sign-in worked; otherwise Continue goes to the link. */
  signedIn: boolean;
}

/**
 * US-006 organization sign-up. The business's sign-in link is generated from
 * its name by the API — nobody types a slug. On success the owner is signed in
 * with the password they just chose and shown that link, to share with staff,
 * before going on as Super Admin. The API's refusals (an email already in
 * use, too many attempts) carry messages written for this screen.
 */
export function SignUpForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fields, setFields] = useState<Partial<Record<FieldName, string>>>({});
  const [created, setCreated] = useState<Created | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: FieldName) => String(form.get(name) ?? "");
    setPending(true);
    setProblem(null);
    setFields({});

    const result = await apiWrite(signUpContract.signUpOrganization, {
      body: {
        organizationName: value("organizationName"),
        name: value("name"),
        email: value("email"),
        phone: value("phone"),
        password: value("password"),
      },
    });

    if (!result.ok) {
      const byField: Partial<Record<FieldName, string>> = {};
      for (const detail of result.details) {
        const field = detail.field as FieldName;
        if (field in LABELS && !byField[field]) {
          byField[field] = `${LABELS[field]} ${detail.issue}.`;
        }
      }
      setFields(byField);
      // A refusal that names a field is shown there, once, not twice.
      setProblem(Object.keys(byField).length > 0 ? null : result.form);
      setPending(false);
      return;
    }

    let signedIn = false;
    try {
      const { error } = await authClient.signIn.email({
        email: value("email"),
        password: value("password"),
      });
      signedIn = !error;
    } catch {
      // The business exists; only the automatic sign-in failed.
    }
    setCreated({ slug: result.body.slug, signedIn });
    setPending(false);
  }

  if (created) {
    const path = `/${created.slug}/sign-in`;
    const link =
      typeof window === "undefined" ? path : `${window.location.origin}${path}`;
    return (
      <div className="flex flex-col gap-[var(--stack-gap)]">
        <FormMessage tone="info">Your business is ready.</FormMessage>
        <Field
          label="Your business’s sign-in link"
          hint="Share it with your staff. You can also sign in at the usual page."
        >
          <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        </Field>
        <Button
          tone="primary"
          className="w-full"
          onClick={() => router.replace(created.signedIn ? "/home" : path)}
        >
          Continue
        </Button>
      </div>
    );
  }

  const field = (name: FieldName) => ({
    name,
    disabled: pending,
    required: true,
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-[var(--stack-gap)]">
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <Field label={LABELS.organizationName} error={fields.organizationName}>
        <Input {...field("organizationName")} autoComplete="organization" />
      </Field>
      <Field label={LABELS.name} error={fields.name}>
        <Input {...field("name")} autoComplete="name" />
      </Field>
      <Field label={LABELS.email} error={fields.email}>
        <Input
          {...field("email")}
          type="email"
          autoComplete="username"
          inputMode="email"
        />
      </Field>
      <Field
        label={LABELS.phone}
        hint="10-digit Indian mobile number."
        error={fields.phone}
      >
        <Input {...field("phone")} type="tel" autoComplete="tel" inputMode="tel" />
      </Field>
      <Field
        label={LABELS.password}
        hint="At least 10 characters. You’ll sign in with this."
        error={fields.password}
      >
        <Input
          {...field("password")}
          type="password"
          autoComplete="new-password"
          minLength={10}
        />
      </Field>
      <Button tone="primary" type="submit" disabled={pending} className="w-full">
        {pending ? "Creating your business…" : "Create business"}
      </Button>
    </form>
  );
}
