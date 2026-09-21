import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "../auth-card";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Forgotten password · Rasi" };

/** US-003, self-service half. The form is the only client part. */
export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Forgotten password"
      description="Give the email your account uses and we will send a link to set a new password."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/sign-in" className="font-medium text-accent underline">
            Sign in
          </Link>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
