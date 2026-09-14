import { createSerwistRoute } from "@serwist/turbopack";

/**
 * Builds and serves the service worker (`/serwist/sw.js`) from `app/sw.ts`.
 * Turbopack has no plugin hook yet, so Serwist bundles the worker with esbuild
 * inside this route handler (docs: serwist.pages.dev/docs/next/turbo). The
 * response allows any scope; the page registers it for `/route` only.
 */
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    swSrc: "app/sw.ts",
    useNativeEsbuild: true,
  });
