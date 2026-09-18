import { Toaster } from "@repo/ui";
import type { ReactNode } from "react";

import { ConsoleShell } from "./console-shell";

/**
 * The admin console (navigation-ia.md#admin-console-structure). Compact
 * density comes from the root layout. Pages under here read data in the
 * browser through the contract client: the API's session cookie is first-party
 * to the browser, and server-side reads would need an internal API address and
 * cookie forwarding that nothing specifies yet.
 *
 * `Toaster` is mounted once here; a screen confirms a save with `toast()`.
 */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ConsoleShell>{children}</ConsoleShell>
      <Toaster />
    </>
  );
}
