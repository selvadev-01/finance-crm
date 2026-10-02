"use client";

import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { canManageOrganisation } from "../../../lib/roles";
import { useSignedIn } from "../../../lib/use-me";
import { REPORT_CARD_CLASS } from "./report-card";

/**
 * The trial balance's entry on the reports index — for Super Admins and
 * Admins only (`ledger.view`): a Senior reading the raw ledger could infer
 * business-wide figures (M09). The API refuses anyone else regardless.
 */
export function TrialBalanceLink() {
  const me = useSignedIn();
  if (!canManageOrganisation(me.role)) return null;
  return (
    <li>
      <Link href="/reports/trial-balance" className={REPORT_CARD_CLASS}>
        <span className="flex items-center justify-between gap-3 text-heading text-ink">
          Trial balance
          <ArrowRight
            aria-hidden
            size={16}
            className="text-ink-subtle transition-colors group-hover:text-accent"
          />
        </span>
        <span className="text-caption text-ink-muted">
          Every ledger account’s balance from its postings, up to a date —
          office cash, cash in hand, receivables, capital and profit — with the
          two sides’ totals, which must agree.
        </span>
      </Link>
    </li>
  );
}
