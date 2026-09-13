import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client.
 *
 * No `baseURL` on purpose. The web app and the API share one origin — behind a
 * reverse proxy in production, and through the /api rewrite in next.config.js
 * during development — so relative requests to /api/auth/* reach NestJS and
 * the session cookie stays first-party.
 *
 * Use it directly (`authClient.signIn`, `authClient.useSession`) rather than
 * destructuring. Re-exporting the bound members trips TS2883: their inferred
 * types reference better-auth internals that cannot be named from here while
 * `declaration` is on.
 */
export const authClient = createAuthClient();
