"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { LANDING, useMe } from "../../lib/use-me";

/**
 * US-001 "I land on the screen for my role": resolves the signed-in staff
 * member and forwards to their role's landing. Renders nothing of its own.
 */
export default function Home() {
  const me = useMe();
  const router = useRouter();

  useEffect(() => {
    if (me) router.replace(LANDING[me.role]);
  }, [me, router]);

  return (
    <p className="sr-only" role="status">
      Loading
    </p>
  );
}
