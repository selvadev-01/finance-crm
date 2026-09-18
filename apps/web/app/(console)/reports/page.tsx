import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@repo/ui";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Reports · Rasi" };

interface ReportEntry {
  href: string;
  title: string;
  description: string;
}

/**
 * The reports that exist (M12). Each report story adds its entry here when
 * its page is built — a link to an unbuilt report is not added early.
 */
const REPORTS: readonly ReportEntry[] = [
  {
    href: "/reports/line-wise",
    title: "Line-wise",
    description:
      "Each line’s staff, customers and accounts, account amount, invested and profit, and expected, collected, pending and extra collection over a date range.",
  },
  {
    href: "/reports/collection",
    title: "Collection",
    description:
      "What each line collected against what was expected over a date range, with every entry classified — correct, low, extra, nothing paid — and the visits that never happened.",
  },
  {
    href: "/reports/overdue",
    title: "Overdue",
    description:
      "The accounts still being collected past their target completion date: how long each has run over, what is still owed, how far behind the plan it is, and when it was last visited.",
  },
  {
    href: "/reports/discrepancy",
    title: "Discrepancies",
    description:
      "Cash collected against cash counted out, by line, day and Junior: what is short, what is over, what is still on its way, and the handover behind each difference.",
  },
  {
    href: "/reports/investment",
    title: "Investment",
    description:
      "What each line was lent and what has come back: account amount, invested and profit as contracted, against the money still out, the money returned and the profit earned on it.",
  },
];

/**
 * Reports index (S-22–26). Super Admins and Admins read every line; a Senior
 * reads their own line, which each report enforces through the API. A Junior
 * never reaches the console.
 */
export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        description="Questions over a date range, with filters. A Senior sees their own line."
      />
      <ul className="grid gap-3 md:grid-cols-2">
        {REPORTS.map((report) => (
          <li key={report.href}>
            <Link
              href={report.href}
              className="group flex h-full flex-col gap-1.5 rounded-surface border border-border bg-surface-raised p-4 shadow-raised transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className="flex items-center justify-between gap-3 text-heading text-ink">
                {report.title}
                <ArrowRight
                  aria-hidden
                  size={16}
                  className="text-ink-subtle transition-colors group-hover:text-accent"
                />
              </span>
              <span className="text-caption text-ink-muted">
                {report.description}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
