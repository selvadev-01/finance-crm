"use client";

import {
  AddressBook,
  ArrowRight,
  MagnifyingGlass,
  Receipt,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import {
  accountContract,
  customerContract,
  staffContract,
} from "@repo/contracts";
import { AppShell, CommandPalette } from "@repo/ui";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { navFor } from "../lib/console-nav";
import { settingsTabsFor } from "../lib/settings-tabs";
import type { Role } from "../lib/roles";
import { ROLE_LABEL } from "../lib/roles";
import { useApiQuery } from "../lib/use-api-query";
import { Money } from "./money";

/** Matches the customer list's own box (US-024), so both feel the same. */
const SEARCH_DELAY_MS = 300;
/** Enough to tell records apart without burying the "Go to" group. */
const PER_GROUP = 5;
/** One character matches nearly everything; it costs three reads to find out. */
const MIN_QUERY = 2;

/**
 * The console's global search (US-024a): one box over customers, accounts,
 * staff and the console's own pages, opened from the topbar or with Ctrl-K.
 *
 * Every group is a list the caller may already read — `customer.view`,
 * `account.view` and `staff.list`, each inside its own scope predicate — so a
 * Senior finds their line's records and nobody else's. Nothing here is a new
 * permission: the palette is a faster way to the same rows, and the API refuses
 * anything it would refuse on the list screens.
 */
export function GlobalSearch({
  role,
  trigger = "field",
}: {
  role: Role;
  /**
   * `field` is the computer layout's topbar, where there is room for a box that
   * looks like what it does. `icon` is the phone app bar, which already carries
   * the area name and the bell — a third box would leave none of them legible.
   */
  trigger?: "field" | "icon";
}) {
  const [open, setOpen] = useState(false);

  // The listener lives here rather than in the shell so the shortcut and the
  // palette cannot disagree about whether it is open.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setOpen((wasOpen) => !wasOpen);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      {trigger === "field" ? (
        <SearchTrigger onOpen={() => setOpen(true)} />
      ) : (
        <AppShell.TopbarAction
          label="Search"
          icon={<MagnifyingGlass aria-hidden />}
        >
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
          />
        </AppShell.TopbarAction>
      )}
      {open ? (
        <SearchPalette role={role} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

/**
 * The topbar control. A button shaped like a field, not a real input: the
 * search happens in the palette, and a second field here would be a second
 * place to type the same thing. The shortcut is on it, so it is discoverable
 * without a tooltip.
 */
function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+K Meta+K"
      className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-control border border-border bg-surface px-2.5 text-left text-body text-ink-subtle transition-colors hover:border-border-strong hover:text-ink-muted sm:max-w-xs"
    >
      <MagnifyingGlass aria-hidden size={16} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">Search</span>
      <kbd
        aria-hidden
        className="hidden shrink-0 rounded-sm border border-border bg-surface-sunken px-1.5 py-0.5 text-2xs font-medium text-ink-subtle sm:block"
      >
        Ctrl K
      </kbd>
    </button>
  );
}

/**
 * The palette itself, mounted only while open so each opening starts empty and
 * the three reads are never in flight behind a closed dialog.
 */
function SearchPalette({ role, onClose }: { role: Role; onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");

  // Debounced exactly as the customer list debounces its own box, so holding a
  // key down does not fire a read per character.
  useEffect(() => {
    const next = text.trim();
    if (next === query) return;
    const timer = setTimeout(() => setQuery(next), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, query]);

  const searching = query.length >= MIN_QUERY;
  const request = searching ? { query: { q: query, limit: PER_GROUP } } : null;

  const customers = useApiQuery(customerContract.listCustomers, request);
  const accounts = useApiQuery(accountContract.listAccounts, request);
  const staff = useApiQuery(staffContract.listStaff, request);

  // The console's own pages, matched here rather than by the API: they are a
  // fixed list this role may see, and `navFor` already dropped the rest.
  //
  // The Settings tabs are searched too, and named by their group. They are
  // one sidebar item away rather than one, so being reachable by name is
  // worth more here than it is for an area with a link of its own.
  const pages = useMemo(() => {
    if (!searching) return [];
    const needle = query.toLowerCase();
    const candidates = [
      ...navFor(role)
        .flatMap((group) => group.items)
        .map((item) => ({ href: item.href, label: item.label, hint: "" })),
      ...settingsTabsFor(role).map((tab) => ({ ...tab, hint: "Settings" })),
    ];
    return candidates
      .filter((page) => page.label.toLowerCase().includes(needle))
      .slice(0, PER_GROUP);
  }, [role, query, searching]);

  function go(href: string) {
    onClose();
    router.push(href);
  }

  const groups = [
    customers.status === "ready" ? customers.data.data.length : 0,
    accounts.status === "ready" ? accounts.data.data.length : 0,
    staff.status === "ready" ? staff.data.data.length : 0,
    pages.length,
  ];
  const found = groups.reduce((total, count) => total + count, 0);
  const loading =
    customers.status === "loading" ||
    accounts.status === "loading" ||
    staff.status === "loading";
  // One group failing is worth saying only when it leaves nothing to show.
  const failed = [customers, accounts, staff].some(
    (state) => state.status === "error",
  );

  return (
    <CommandPalette
      open
      onClose={onClose}
      query={text}
      onQueryChange={setText}
      label="Search customers, accounts, team and pages"
      placeholder="Search customers, accounts, team…"
    >
      {!searching ? (
        <CommandPalette.Message>
          Search by name, customer code, account code or mobile.
        </CommandPalette.Message>
      ) : loading && found === 0 ? (
        <CommandPalette.Message>Searching…</CommandPalette.Message>
      ) : found === 0 ? (
        <CommandPalette.Message>
          {failed
            ? "This couldn’t be searched just now. Try again in a moment."
            : `Nothing matches “${query}”.`}
        </CommandPalette.Message>
      ) : null}

      {customers.status === "ready" && customers.data.data.length > 0 ? (
        <CommandPalette.Group title="Customers">
          {customers.data.data.map((customer) => (
            <CommandPalette.Item
              key={customer.id}
              value={`customer:${customer.id}`}
              icon={<AddressBook aria-hidden size={18} />}
              label={customer.name}
              hint={`${customer.customerCode} · ${customer.lineName}`}
              onSelect={() => go(`/customers/${customer.id}`)}
            />
          ))}
        </CommandPalette.Group>
      ) : null}

      {accounts.status === "ready" && accounts.data.data.length > 0 ? (
        <CommandPalette.Group title="Accounts">
          {accounts.data.data.map((account) => (
            <CommandPalette.Item
              key={account.id}
              value={`account:${account.id}`}
              icon={<Receipt aria-hidden size={18} />}
              label={account.accountCode}
              hint={`${account.customerName} · ${account.lineName}`}
              meta={<Money amount={account.outstandingAmount} />}
              onSelect={() => go(`/accounts/${account.id}`)}
            />
          ))}
        </CommandPalette.Group>
      ) : null}

      {staff.status === "ready" && staff.data.data.length > 0 ? (
        <CommandPalette.Group title="Team">
          {staff.data.data.map((member) => (
            <CommandPalette.Item
              key={member.staffProfileId}
              value={`staff:${member.staffProfileId}`}
              icon={<UsersThree aria-hidden size={18} />}
              label={member.name}
              hint={`${member.staffCode} · ${ROLE_LABEL[member.role]}`}
              onSelect={() => go(`/team/${member.staffProfileId}`)}
            />
          ))}
        </CommandPalette.Group>
      ) : null}

      {pages.length > 0 ? (
        <CommandPalette.Group title="Go to">
          {pages.map((page) => (
            <CommandPalette.Item
              key={page.href}
              value={`page:${page.href}`}
              icon={<ArrowRight aria-hidden size={18} />}
              label={page.label}
              hint={page.hint || undefined}
              onSelect={() => go(page.href)}
            />
          ))}
        </CommandPalette.Group>
      ) : null}
    </CommandPalette>
  );
}
