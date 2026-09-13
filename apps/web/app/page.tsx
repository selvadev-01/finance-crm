import {
  Badge,
  Button,
  NoMatches,
  NothingYet,
  NotPermitted,
  formatBusinessDate,
  formatCurrency,
} from "@repo/ui";

/**
 * Design-system preview.
 *
 * Not a product screen — Rasi has none yet. This exists so the token set and
 * the component base can be seen and reviewed at 360px and at desktop width,
 * and so the Tailwind wiring is demonstrably working end to end: if the
 * `@source` directive in theme.css ever stops reaching @repo/ui, this page
 * renders unstyled and the problem is obvious immediately rather than in
 * whichever feature screen happens to ship next.
 *
 * Replace it with the real landing route when M01 lands.
 */
export default function DesignPreview() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-ink">Rasi design system</h1>
        <p className="text-sm text-ink-muted">
          Tokens and component base. Not a product screen.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink-muted">Money and dates</h2>
        <div className="flex flex-col gap-1 rounded-[var(--radius-surface)] border border-border bg-surface-raised p-4">
          <p className="text-2xl font-semibold text-ink" data-numeric>
            {formatCurrency("123456.5")}
          </p>
          <p className="text-sm text-ink-muted">
            Indian grouping, from a decimal string. Due{" "}
            {formatBusinessDate("2026-09-13")}.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink-muted">Actions</h2>
        <div className="flex flex-wrap gap-2">
          <Button tone="primary">Record collection</Button>
          <Button tone="secondary">Cancel</Button>
          <Button tone="ghost">View history</Button>
          <Button tone="danger">Write off account</Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink-muted">Status</h2>
        <div className="flex flex-wrap gap-2">
          <Badge tone="positive">Collected</Badge>
          <Badge tone="warning">Low</Badge>
          <Badge tone="critical">Missed</Badge>
          <Badge tone="info">Syncing</Badge>
          <Badge tone="neutral">Saved on device</Badge>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink-muted">
          Empty states — three different things
        </h2>
        <div className="grid gap-3">
          <div className="rounded-[var(--radius-surface)] border border-border bg-surface-raised">
            <NothingYet
              title="No customers yet"
              description="Onboard the first customer on this line to get started."
              action={<Button tone="primary">Onboard customer</Button>}
            />
          </div>
          <div className="rounded-[var(--radius-surface)] border border-border bg-surface-raised">
            <NoMatches
              title="No customers match this filter"
              description="There are customers on this line, just none matching what you searched for."
              action={<Button tone="secondary">Clear filters</Button>}
            />
          </div>
          <div className="rounded-[var(--radius-surface)] border border-border bg-surface-raised">
            <NotPermitted />
          </div>
        </div>
      </section>
    </main>
  );
}
