import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/**
 * Development-only proxy so the browser talks to one origin.
 *
 * Production serves the web app and the API from a single origin behind a
 * reverse proxy, which keeps the session cookie first-party. Development would
 * otherwise run cross-origin (:3000 to :3001) and need `sameSite: "none"` plus
 * `secure: true` — and `secure` cannot be set over plain HTTP, so that
 * configuration does not actually work locally.
 *
 * Proxying /api here makes development match production instead of
 * approximating it. That matters most for the offline service worker, which
 * replays queued requests and is exactly where a cross-site cookie fails
 * quietly (authentication.md).
 *
 * Written as a phase function rather than reading `process.env.NODE_ENV`:
 * Next tells us the phase directly, and the config then needs no Node globals.
 *
 * @param {string} phase
 * @returns {import('next').NextConfig}
 */
export default function nextConfig(phase) {
  const isDevServer = phase === PHASE_DEVELOPMENT_SERVER;

  return {
    async rewrites() {
      if (!isDevServer) {
        return [];
      }

      return [
        {
          source: "/api/:path*",
          destination: "http://localhost:3001/api/:path*",
        },
      ];
    },
  };
}
