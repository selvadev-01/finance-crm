/**
 * The Junior's field app: `comfortable` density, so every control is a 44px
 * touch target at 360px (design-system.md).
 */
export default function RouteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div data-density="comfortable">{children}</div>;
}
