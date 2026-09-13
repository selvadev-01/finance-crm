import type { Metadata } from "next";

import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Set a new password · Rasi" };

/**
 * US-003. Reached after signing in with a temporary password from an Admin
 * reset: until a new password is set, the API refuses every other screen.
 */
export default function ChangePasswordPage() {
  return (
    <section className="flex flex-col gap-6 rounded-[var(--radius-surface)] border border-border bg-surface-raised p-6 shadow-[var(--shadow-raised)]">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">Set a new password</h1>
        <p className="text-sm text-ink-muted">
          Your password was reset. Choose a new one to continue.
        </p>
      </header>
      <ChangePasswordForm />
    </section>
  );
}
