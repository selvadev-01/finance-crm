import {
  Badge,
  Button,
  Field,
  FormMessage,
  Input,
  NoMatches,
  NothingYet,
  NotPermitted,
  Select,
  Textarea,
  Toaster,
  cn,
  formatBusinessDate,
  formatCurrency,
} from "@repo/ui";
import type { ReactNode } from "react";

import { DashboardPreview } from "./dashboard-preview";
import { InteractivePreview, RecordsPreview } from "./interactive-preview";

export const metadata = { title: "Design system · Rasi" };

/**
 * Design-system preview (design-system.md#preview).
 *
 * Not a product screen. It exists so the token set and the component base can
 * be seen and reviewed at 360px and at desktop width, in both densities, and
 * so the Tailwind wiring is demonstrably working end to end: if the `@source`
 * directive in theme.css ever stops reaching @repo/ui, this page renders
 * unstyled and the problem is obvious immediately rather than in whichever
 * feature screen happens to ship next. Contrast is not eyeballed here — it is
 * asserted by `packages/ui/src/theme.test.ts`.
 */
export default function DesignPreview() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-[var(--section-gap)] px-[var(--page-padding)] py-10">
      <header className="flex flex-col gap-1.5 border-b border-border pb-5">
        <p className="text-label text-ink-muted">Rasi · ADR-0013</p>
        <h1 className="text-display text-ink">Design system</h1>
        <p className="text-body text-ink-muted">
          Soft teal: calm and fresh. Tokens and the component base — not a
          product screen.
        </p>
      </header>

      <Block title="Colour">
        <div className="grid gap-3 sm:grid-cols-2">
          <Swatches
            label="Surfaces and ink"
            items={[
              ["surface", "bg-surface"],
              ["surface-raised", "bg-surface-raised"],
              ["surface-sunken", "bg-surface-sunken"],
              ["surface-nav", "bg-surface-nav"],
              ["border", "bg-border"],
              ["border-strong", "bg-border-strong"],
              ["ink", "bg-ink"],
              ["ink-muted", "bg-ink-muted"],
              ["ink-subtle", "bg-ink-subtle"],
            ]}
          />
          <Swatches
            label="Accent"
            items={[
              ["accent", "bg-accent"],
              ["accent-hover", "bg-accent-hover"],
              ["accent-subtle", "bg-accent-subtle"],
            ]}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              [
                "positive",
                "bg-positive",
                "bg-positive-subtle",
                "bg-positive-border",
                "bg-positive-bright",
              ],
              [
                "warning",
                "bg-warning",
                "bg-warning-subtle",
                "bg-warning-border",
                "bg-warning-bright",
              ],
              [
                "critical",
                "bg-critical",
                "bg-critical-subtle",
                "bg-critical-border",
                "bg-critical-bright",
              ],
              [
                "info",
                "bg-info",
                "bg-info-subtle",
                "bg-info-border",
                "bg-info-bright",
              ],
            ] as const
          ).map(([tone, strong, subtle, border, bright]) => (
            <Swatches
              key={tone}
              label={tone}
              items={[
                [tone, strong],
                ["-subtle", subtle],
                ["-border", border],
                ["-bright", bright],
              ]}
            />
          ))}
        </div>
      </Block>

      <Block title="Type">
        <div className="flex flex-col divide-y divide-border rounded-surface border border-border bg-surface-raised">
          {(
            [
              ["display", "text-display", "Collections · 16 Sep 2026"],
              ["title", "text-title", "Kumar Traders · LN-07"],
              ["heading", "text-heading", "Needs a look"],
              [
                "body",
                "text-body",
                "Collected ₹1,23,456.50 against ₹1,30,000.00 expected.",
              ],
              ["label", "text-label", "Amount collected"],
              ["caption", "text-caption", "Asked by Priya · 2 hours ago"],
              [
                "2xs",
                "text-2xs font-medium tracking-wider uppercase",
                "Outstanding",
              ],
              ["mono", "font-mono text-body", "CUS-00412 · ACC-2026-0091"],
            ] as const
          ).map(([name, className, sample]) => (
            <div
              key={name}
              className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-6"
            >
              <span className="w-20 shrink-0 text-caption text-ink-subtle">
                {name}
              </span>
              <span className={cn("text-ink", className)}>{sample}</span>
            </div>
          ))}
        </div>
        <p className="text-body text-ink-muted" data-numeric>
          Tabular figures: {formatCurrency("111111.11")} /{" "}
          {formatCurrency("98765.40")} — due {formatBusinessDate("2026-09-13")}.
        </p>
      </Block>

      <Block title="Actions">
        <div className="flex flex-wrap items-center gap-2">
          <Button tone="primary">Record collection</Button>
          <Button tone="secondary">Cancel</Button>
          <Button tone="ghost">View history</Button>
          <Button tone="danger">Write off account</Button>
          <Button tone="link">Clear filters</Button>
          <Button tone="primary" disabled>
            Saving…
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button tone="secondary" size="sm">
            Export
          </Button>
          <Button tone="ghost" size="sm">
            Mark read
          </Button>
          <span className="text-caption text-ink-muted">
            <code className="font-mono">size=&quot;sm&quot;</code> — console
            toolbars only
          </span>
        </div>
      </Block>

      <Block title="Status">
        <div className="flex flex-wrap gap-2">
          <Badge tone="positive">Collected</Badge>
          <Badge tone="warning">Low</Badge>
          <Badge tone="critical">Missed</Badge>
          <Badge tone="info">Syncing</Badge>
          <Badge tone="neutral">Saved on device</Badge>
        </div>
        <div className="flex flex-col gap-2">
          <FormMessage tone="critical">
            Could not reach Rasi. Check your connection and try again.
          </FormMessage>
          <FormMessage
            tone="warning"
            action={<Button size="sm">Save anyway</Button>}
          >
            9876543210 is already the mobile number of Kumar Traders.
          </FormMessage>
          <FormMessage tone="info">Sunday: no collections are due.</FormMessage>
        </div>
      </Block>

      <Block title="Forms — both densities">
        <div className="grid gap-4 lg:grid-cols-2">
          {(["compact", "comfortable"] as const).map((density) => (
            <div
              key={density}
              data-density={density}
              className="flex flex-col gap-[var(--stack-gap)] rounded-surface border border-border bg-surface-raised p-5"
            >
              <p className="text-caption text-ink-subtle">{density}</p>
              <Field label="Customer name" hint="As on their ID.">
                <Input defaultValue="Kumar Traders" />
              </Field>
              <Field label="Line">
                <Select defaultValue="ln7">
                  <option value="ln7">LN-07 · Market Road</option>
                  <option value="ln8">LN-08 · Bus Stand</option>
                </Select>
              </Field>
              <Field
                label="Amount collected (₹)"
                error="Amount must be at most 500.00."
              >
                <Input defaultValue="650.00" inputMode="decimal" data-numeric />
              </Field>
              <Field label="Note">
                <Textarea placeholder="Optional" />
              </Field>
              <Field label="Disabled">
                <Input defaultValue="Read only" disabled />
              </Field>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Interactive">
        <InteractivePreview />
        <Toaster />
      </Block>

      <Block title="Records">
        <RecordsPreview />
      </Block>

      <Block title="Dashboards — flat surfaces (ADR-0015)">
        <DashboardPreview />
      </Block>

      <Block title="Empty states — three different things">
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-surface border border-border bg-surface-raised">
            <NothingYet
              title="No customers yet"
              description="Onboard the first customer on this line to get started."
              action={<Button tone="primary">Onboard customer</Button>}
            />
          </div>
          <div className="rounded-surface border border-border bg-surface-raised">
            <NoMatches
              title="No customers match this filter"
              description="There are customers on this line, just none matching what you searched for."
              action={<Button tone="secondary">Clear filters</Button>}
            />
          </div>
          <div className="rounded-surface border border-border bg-surface-raised">
            <NotPermitted />
          </div>
        </div>
      </Block>
    </main>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-heading text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Swatches({
  label,
  items,
}: {
  label: string;
  items: readonly (readonly [string, string])[];
}) {
  return (
    <div className="flex flex-col gap-2 rounded-surface border border-border bg-surface-raised p-3">
      <p className="text-label text-ink">{label}</p>
      <ul className="grid grid-cols-2 gap-2">
        {items.map(([name, className]) => (
          <li key={name} className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn(
                "size-6 shrink-0 rounded-control border border-border",
                className,
              )}
            />
            <span className="truncate font-mono text-2xs text-ink-muted">
              {name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
