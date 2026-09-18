import { Breadcrumbs } from "@repo/ui";
import Link from "next/link";

export interface TrailStep {
  label: string;
  /** Omit for the page itself. */
  href?: string;
}

/**
 * The rollup chain above a page title — Collections / Kumar Traders — with
 * real links for every level above (navigation-ia.md#drill-down-follows-the-rollup-chain).
 */
export function PageTrail({ steps }: { steps: readonly TrailStep[] }) {
  return (
    <Breadcrumbs>
      {steps.map((step) =>
        step.href ? (
          <Link key={step.href} href={step.href}>
            {step.label}
          </Link>
        ) : (
          <span key={step.label} className="text-ink">
            {step.label}
          </span>
        ),
      )}
    </Breadcrumbs>
  );
}
