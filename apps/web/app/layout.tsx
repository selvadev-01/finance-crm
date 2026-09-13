import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Rasi",
  description: "Daily collection management",
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
    <html lang="en" data-density="compact">
      <body>{children}</body>
    </html>
  );
}
