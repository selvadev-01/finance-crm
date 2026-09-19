import type { MetadataRoute } from "next";

import { BRAND_CANVAS, BRAND_TEAL } from "./brand-colours";

/**
 * Makes Rasi installable (ADR-0016). One app for every role: it opens on
 * `/home`, which sends each person to their landing (navigation-ia.md), so a
 * Junior's installed app opens the route and everyone else's the console. The
 * console then asks, on this device's first launch, for the phone or the
 * computer layout.
 *
 * The scope is the whole site. The Junior's service worker keeps its own,
 * narrower scope, `/route` (ADR-0008), and is unaffected.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Rasi",
    short_name: "Rasi",
    description: "Daily collection management",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: BRAND_CANVAS,
    theme_color: BRAND_TEAL,
    icons: [
      {
        src: "/pwa-icon/192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icon/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icon/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
