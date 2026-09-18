import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "../auth-card";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create a business · Rasi" };

/** US-006. The form is the only client part; the page itself is static. */
export default function SignUpPage() {
  return (
    <AuthCard
      title="Create a business"
      description="You’ll be its Super Admin, and set up its sectors and lines."
      footer={
        <>
          Already on Rasi?{" "}
          <Link href="/sign-in" className="font-medium text-accent underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthCard>
  );
}
