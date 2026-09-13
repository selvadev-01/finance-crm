"use client";

import { type Me, staffContract } from "@repo/contracts";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";

import { api } from "./api-client";

/**
 * Where each role lands after sign-in (navigation-ia.md#landing-by-role): the
 * console dashboard for everyone but the Junior, whose home is the route.
 */
export const LANDING: Record<Me["role"], string> = {
  SUPER_ADMIN: "/dashboard",
  ADMIN: "/dashboard",
  SENIOR: "/dashboard",
  JUNIOR: "/route",
};

/**
 * The signed-in staff member, or a redirect: no session → sign-in; a pending
 * forced password change → change-password (US-003). The API decides both —
 * the client only follows its answer.
 */
export function useMe(): Me | null {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    api(staffContract.me, {})
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setMe(result.body);
        } else if (result.body?.code === "PASSWORD_CHANGE_REQUIRED") {
          router.replace("/change-password");
        } else {
          router.replace("/sign-in");
        }
      })
      .catch(() => {
        if (!cancelled) router.replace("/sign-in");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return me;
}

/** Provided by the console shell once `useMe` has an answer. */
export const SignedInContext = createContext<Me | null>(null);

/** The signed-in staff member inside the console. */
export function useSignedIn(): Me {
  const me = useContext(SignedInContext);
  if (!me) {
    throw new Error("useSignedIn is only available inside the console shell");
  }
  return me;
}
