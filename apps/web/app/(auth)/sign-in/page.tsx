import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "../auth-card";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in · Rasi" };

/**
 * US-001. The form is the only client part; the page itself is static, which
 * is why the reset screen confirms its own success rather than sending a flag
 * here to be read (US-003).
 */
export default function SignInPage() {
  return (
    <AuthCard
      title="Sign in"
      description="Use the email and password your administrator gave you."
      footer={
        <>
          <Link
            href="/forgot-password"
            className="font-medium text-accent underline"
          >
            Forgotten your password?
          </Link>
          <br />
          Setting up a new business?{" "}
          <Link href="/sign-up" className="font-medium text-accent underline">
            Create one
          </Link>
        </>
      }
    >
      <SignInForm />
    </AuthCard>
  );
}
