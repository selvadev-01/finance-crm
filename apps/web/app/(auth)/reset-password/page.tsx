import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "../auth-card";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Set a new password · Rasi" };

/**
 * US-003. Reached from the emailed link, by way of Better Auth's callback:
 * a good token arrives as `?token=`, a spent or expired one as
 * `?error=INVALID_TOKEN` with nothing to submit.
 */
export default async function ResetPasswordPage(
  props: PageProps<"/reset-password">,
) {
  const { token } = await props.searchParams;
  // A repeated ?token= arrives as an array; neither half of it is a link
  // anyone was sent, so treat it as no token at all.
  const oneToken = typeof token === "string" ? token : undefined;

  if (!oneToken) {
    return (
      <AuthCard
        title="That link no longer works"
        description="A reset link works once and lasts 30 minutes. Ask for another and use the newest email."
        footer={
          <Link
            href="/forgot-password"
            className="font-medium text-accent underline"
          >
            Send a new link
          </Link>
        }
      />
    );
  }

  return (
    <AuthCard
      title="Set a new password"
      description="Choose a password you have not used on Rasi before. Every device will be signed out."
    >
      <ResetPasswordForm token={oneToken} />
    </AuthCard>
  );
}
