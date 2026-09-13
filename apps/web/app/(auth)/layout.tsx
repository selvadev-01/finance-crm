/**
 * Sign-in and password screens.
 *
 * `comfortable` density: these are used on a Junior's phone as often as at a
 * desk, so every control is a 44px touch target. One narrow column, no
 * chrome — the only thing to do here is sign in.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      data-density="comfortable"
      className="flex min-h-dvh items-start justify-center bg-surface-sunken px-4 py-12 sm:items-center sm:py-16"
    >
      <main className="flex w-full max-w-sm flex-col gap-6">
        <p className="text-lg font-semibold tracking-tight text-ink">Rasi</p>
        {children}
      </main>
    </div>
  );
}
