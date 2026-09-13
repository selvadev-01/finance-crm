"use client";

import type { Me } from "@repo/contracts";
import { Button, NothingYet } from "@repo/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { authClient } from "./auth-client";
import { ROLE_LABEL } from "./roles";
import { LANDING, useMe } from "./use-me";

/**
 * A role's landing while its real screen is unbuilt (US-001): who is signed in,
 * an honest "not built yet", and sign-out. A staff member who opens another
 * role's landing is sent to their own — convenience only; the API is what
 * refuses the data (M02).
 */
export function RoleLanding({
  screen,
  role,
}: {
  /** The screen that will live here, e.g. "Today's route". */
  screen: string;
  role: Me["role"][];
}) {
  const me = useMe();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (me && !role.includes(me.role)) router.replace(LANDING[me.role]);
  }, [me, role, router]);

  if (!me || !role.includes(me.role)) {
    return (
      <p className="sr-only" role="status">
        Loading
      </p>
    );
  }

  async function signOut() {
    setSigningOut(true);
    await authClient.signOut();
    router.replace("/sign-in");
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex flex-col">
          <p className="text-lg font-semibold text-ink">{screen}</p>
          <p className="text-sm text-ink-muted">
            {me.name} · {ROLE_LABEL[me.role]}
          </p>
        </div>
        <Button tone="secondary" onClick={signOut} disabled={signingOut}>
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </header>
      <NothingYet
        title={`${screen} isn’t built yet`}
        description="You’re signed in. This screen arrives with a later release."
      />
    </main>
  );
}
