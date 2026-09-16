import { Bell, CloudCheck, CloudSlash } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@repo/ui";

import { openView } from "./hash-view";

/**
 * The one piece of chrome on every Junior screen (navigation-ia.md): whether
 * Rasi is reachable, how many collections are still on the phone, and the bell.
 * "Is my day safe" is answered without tapping; tapping the count opens S-03,
 * the bell S-21. The unread count is null while unknown (no signal).
 */
export function StatusBar({
  connected,
  unsynced,
  unread,
}: {
  connected: boolean;
  unsynced: number;
  unread: number | null;
}) {
  return (
    <header
      className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-surface-raised px-4 py-2"
      data-testid="status-bar"
    >
      <span
        className={cn(
          "flex items-center gap-1.5 text-sm font-medium",
          // Amber text on white is 3.31:1; the icon carries the colour.
          connected ? "text-positive" : "text-ink",
        )}
        role="status"
      >
        {connected ? (
          <CloudCheck aria-hidden size={20} weight="regular" />
        ) : (
          <CloudSlash
            aria-hidden
            size={20}
            weight="regular"
            className="text-warning"
          />
        )}
        <span data-testid="connection">{connected ? "Online" : "Offline"}</span>
      </span>
      <span className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => openView("#notifications")}
          aria-label={
            unread ? `Notifications, ${unread} unread` : "Notifications"
          }
          className="relative flex min-h-[var(--control-height)] items-center rounded-[var(--radius-control)] px-3 text-ink hover:bg-surface-sunken"
          data-testid="bell"
        >
          <Bell aria-hidden size={22} weight="regular" />
          {unread ? (
            <span
              aria-hidden
              data-numeric
              className="absolute top-1 right-1 min-w-4 rounded-full bg-critical px-1 text-center text-2xs leading-4 font-semibold text-ink-inverse"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => openView("#sync")}
          className={cn(
            "flex min-h-[var(--control-height)] items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm font-medium",
            unsynced > 0
              ? "border border-warning bg-warning-subtle text-ink"
              : "border border-transparent bg-positive-subtle text-positive",
          )}
        >
          <span
            data-testid="unsynced-count"
            data-numeric
            className="text-base font-semibold"
          >
            {unsynced}
          </span>
          not sent
        </button>
      </span>
    </header>
  );
}
