"use client";

import { buttonClass, EmptyFrame, NothingYet, PageHeader } from "@repo/ui";
import Link from "next/link";

import { canManageOrganisation, type Role } from "../../../lib/roles";
import { useSignedIn } from "../../../lib/use-me";

const TITLE = {
  SUPER_ADMIN: "Business overview",
  ADMIN: "Today’s operations",
  SENIOR: "Your line today",
  JUNIOR: "Today’s route",
} as const;

interface QuickLink {
  href: string;
  label: string;
  shownTo: (role: Role) => boolean;
}

const everyone = () => true;

/** The areas the console navigation offers each role (console-shell.tsx). */
const QUICK_LINKS: QuickLink[] = [
  { href: "/collections", label: "Collections", shownTo: everyone },
  { href: "/customers", label: "Customers", shownTo: everyone },
  { href: "/cash", label: "Cash", shownTo: everyone },
  { href: "/lines", label: "Lines", shownTo: everyone },
  { href: "/sectors", label: "Sectors", shownTo: canManageOrganisation },
];

/**
 * Shown to a role with no dashboard of its own (a Junior, whose landing is
 * the route).
 * S-07 says a figure that cannot be computed must never show as 0, so there
 * are no placeholder stats.
 */
export function DashboardPlaceholder() {
  const me = useSignedIn();
  const links = QUICK_LINKS.filter((link) => link.shownTo(me.role));
  return (
    <>
      <PageHeader
        title={TITLE[me.role]}
        description={`Signed in as ${me.name}`}
      />
      <EmptyFrame>
        <NothingYet
          title="The dashboard arrives in Phase 5"
          description="Collection and money figures will be summarised here. Until then it shows nothing rather than zeros — open an area below for today’s work."
          action={
            <nav
              aria-label="Quick links"
              className="flex flex-wrap justify-center gap-2"
            >
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={buttonClass("secondary")}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          }
        />
      </EmptyFrame>
    </>
  );
}
