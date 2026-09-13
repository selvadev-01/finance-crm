"use client";

import { buttonClass, NothingYet, PageHeader } from "@repo/ui";
import Link from "next/link";

import { canManageOrganisation } from "../../../lib/roles";
import { useSignedIn } from "../../../lib/use-me";

const TITLE = {
  SUPER_ADMIN: "Business overview",
  ADMIN: "Today’s operations",
  SENIOR: "Your line today",
  JUNIOR: "Today’s route",
} as const;

export function DashboardPlaceholder() {
  const me = useSignedIn();
  const manages = canManageOrganisation(me.role);
  return (
    <>
      <PageHeader
        title={TITLE[me.role]}
        description={`Signed in as ${me.name}`}
      />
      <div className="rounded-[var(--radius-surface)] border border-border bg-surface-raised">
        <NothingYet
          title="Figures arrive with collections"
          description="This dashboard shows collection and money figures once accounts and collections are recorded. Until then it shows nothing rather than zeros."
          action={
            <Link
              href={manages ? "/sectors" : "/lines"}
              className={buttonClass("secondary")}
            >
              {manages ? "Set up sectors and lines" : "View your line"}
            </Link>
          }
        />
      </div>
    </>
  );
}
