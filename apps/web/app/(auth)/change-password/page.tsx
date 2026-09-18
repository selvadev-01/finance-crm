import type { Metadata } from "next";

import { AuthCard } from "../auth-card";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Set a new password · Rasi" };

/**
 * US-003. Reached after signing in with a temporary password from an Admin
 * reset: until a new password is set, the API refuses every other screen.
 */
export default function ChangePasswordPage() {
  return (
    <AuthCard
      title="Set a new password"
      description="Your password was reset. Choose a new one to continue."
    >
      <ChangePasswordForm />
    </AuthCard>
  );
}
