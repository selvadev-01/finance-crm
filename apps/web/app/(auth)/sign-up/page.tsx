import type { Metadata } from "next";
import Link from "next/link";

import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create a business · Rasi" };

/** US-006. The form is the only client part; the page itself is static. */
export default function SignUpPage() {
  return (
    <section className="flex flex-col gap-6 rounded-[var(--radius-surface)] border border-border bg-surface-raised p-6 shadow-[var(--shadow-raised)]">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">Create a business</h1>
        <p className="text-sm text-ink-muted">
          You’ll be its Super Admin, and set up its sectors and lines.
        </p>
      </header>
      <SignUpForm />
      <p className="text-sm text-ink-muted">
        Already on Rasi?{" "}
        <Link href="/sign-in" className="font-medium text-accent underline">
          Sign in
        </Link>
      </p>
    </section>
  );
}
