"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { firstSettingsTab } from "../../../lib/settings-tabs";
import { useSignedIn } from "../../../lib/use-me";

/**
 * `/settings` holds nothing of its own — it is the group, and the group's
 * parts are its tabs. It sends the reader to the first tab their role may
 * open: business settings for a Super Admin (US-094), holidays for everyone
 * else (US-093).
 *
 * The role only exists in the browser, so this is a client redirect. There is
 * no server session to read: every console page fetches `/api/me` itself.
 */
export default function SettingsPage() {
  const me = useSignedIn();
  const router = useRouter();
  const destination = firstSettingsTab(me.role);

  useEffect(() => {
    router.replace(destination);
  }, [router, destination]);

  return (
    <p className="sr-only" role="status">
      Opening settings
    </p>
  );
}
