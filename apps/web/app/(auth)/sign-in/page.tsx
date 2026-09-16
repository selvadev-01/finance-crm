import type { Metadata } from "next";
import Link from "next/link";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in · Rasi" };

/** US-001. The form is the only client part; the page itself is static. */
export default function SignInPage() {
  return (
    <section className="flex flex-col gap-6 rounded-[var(--radius-surface)] border border-border bg-surface-raised p-6 shadow-[var(--shadow-raised)]">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">Sign in</h1>
        <p className="text-sm text-ink-muted">
          Use the email and password your administrator gave you.
        </p>
      </header>
      <SignInForm />
      <p className="text-sm text-ink-muted">
        Setting up a new business?{" "}
        <Link href="/sign-up" className="font-medium text-accent underline">
          Create one
        </Link>
      </p>
    </section>
  );
}
