"use client";

import { signUpContract } from "@repo/contracts";
import {
  Button,
  Field,
  Form,
  FormField,
  FormMessage,
  FormRootError,
  Input,
  SubmitButton,
  useZodForm,
} from "@repo/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiWrite } from "../../../lib/api-write";
import { authClient } from "../../../lib/auth-client";
import { applyWriteFailure } from "../../../lib/form-errors";

type FieldName = "organizationName" | "name" | "email" | "phone" | "password";

const LABELS: Record<FieldName, string> = {
  organizationName: "Business name",
  name: "Your name",
  email: "Email",
  phone: "Mobile number",
  password: "Password",
};

const FIELDS = Object.keys(LABELS) as FieldName[];

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
 *
 * Validated in the browser against the contract's own body schema (ADR-0013).
 */
export function SignUpForm() {
  const router = useRouter();
  const [created, setCreated] = useState<Created | null>(null);
  const form = useZodForm(signUpContract.signUpOrganization.body, {
    defaultValues: {
      organizationName: "",
      name: "",
      email: "",
      phone: "",
      password: "",
    },
  });

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
          <Input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
          />
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

  return (
    <Form
      form={form}
      onSubmit={async (body) => {
        const result = await apiWrite(
          signUpContract.signUpOrganization,
          { body },
          { fields: LABELS },
        );
        if (!result.ok) {
          applyWriteFailure(form.setError, result, { fields: FIELDS });
          return;
        }

        let signedIn = false;
        try {
          const { error } = await authClient.signIn.email({
            email: body.email,
            password: body.password,
          });
          signedIn = !error;
        } catch {
          // The business exists; only the automatic sign-in failed.
        }
        setCreated({ slug: result.body.slug, signedIn });
      }}
    >
      <FormRootError />
      <FormField name="organizationName" label={LABELS.organizationName}>
        <Input autoComplete="organization" />
      </FormField>
      <FormField name="name" label={LABELS.name}>
        <Input autoComplete="name" />
      </FormField>
      <FormField name="email" label={LABELS.email}>
        <Input type="email" autoComplete="username" inputMode="email" />
      </FormField>
      <FormField
        name="phone"
        label={LABELS.phone}
        hint="10-digit Indian mobile number."
      >
        <Input type="tel" autoComplete="tel" inputMode="tel" />
      </FormField>
      <FormField
        name="password"
        label={LABELS.password}
        hint="At least 10 characters. You’ll sign in with this."
      >
        <Input type="password" autoComplete="new-password" />
      </FormField>
      <SubmitButton pendingLabel="Creating your business…" className="w-full">
        Create business
      </SubmitButton>
    </Form>
  );
}
