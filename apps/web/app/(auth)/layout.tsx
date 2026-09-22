/**
 * Sign-in and password screens.
 *
 * `comfortable` density: these are used on a Junior's phone as often as at a
 * desk, so every control is a 44px touch target. One narrow column, no
 * chrome — the only thing to do here is sign in.
 *
 * On a phone they read as the installed app's own first screen (J-00): a
 * full-bleed white page under a large app mark, not a card floating on grey.
 * From `sm` up they are a card again.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      data-density="comfortable"
      className="flex min-h-dvh items-start justify-center bg-surface-raised px-5 pt-[max(3rem,env(safe-area-inset-top))] pb-10 sm:items-center sm:bg-surface-sunken sm:px-4 sm:py-16"
    >
      <main className="flex w-full max-w-sm flex-col gap-8 sm:gap-6">
        <p className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-14 place-items-center rounded-overlay bg-accent text-2xl font-semibold text-accent-ink sm:size-10 sm:rounded-surface sm:text-lg"
          >
            R
          </span>
          <span className="flex flex-col">
            <span className="text-xl font-semibold tracking-tight text-ink">
              Rasi
            </span>
            <span className="text-sm text-ink-muted">Daily collections</span>
          </span>
        </p>
        {children}
      </main>
    </div>
  );
}
