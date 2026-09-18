/**
 * The Junior's field app: `comfortable` density, so every control is a 44px
 * touch target at 360px (design-system.md), and the system font, so a phone
 * on a poor connection never waits for a webfont (ADR-0013).
 */
export default function RouteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div data-density="comfortable" data-font="system">
      {children}
    </div>
  );
}
