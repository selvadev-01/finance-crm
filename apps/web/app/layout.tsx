import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import { BRAND_TEAL } from "./brand-colours";
import "./globals.css";

/**
 * IBM Plex, self-hosted by `next/font` (ADR-0013). `preload: false` is
 * deliberate: a font is fetched only when text on the page uses it, so the
 * Junior's route — which sets `font-system` — never downloads it, while the
 * console picks it up as its stylesheet is read. `latin-ext` carries ₹.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
  display: "swap",
  preload: false,
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "Rasi",
  description: "Daily collection management",
  // Home-screen installs on iPhone and iPad, which read these instead of the
  // manifest (ADR-0016).
  appleWebApp: { capable: true, title: "Rasi", statusBarStyle: "default" },
};

/**
 * 360px is the design target for the Junior's field app, and the admin console
 * is a desktop surface. Locking the initial scale keeps a mis-tap from zooming
 * a form mid-entry; `viewportFit` keeps content clear of notches.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: BRAND_TEAL,
};

/**
 * `data-density="compact"` is the default because the admin console is the
 * larger surface. The Junior's route screens set `comfortable` on their own
 * layout, which widens every control to a 44px touch target without any
 * component taking a prop.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-density="compact"
      className={`${plexSans.variable} ${plexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
