"use client";

import { CircleNotch } from "@phosphor-icons/react/dist/ssr";
import { createContext, use, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/**
 * Set inside a `Form`: the form draws one overlay for its whole submit, so a
 * busy `Button` within it must not draw a second.
 */
export const BusyScope = createContext(false);

/**
 * What a busy `Button` draws: the overlay, unless a `Form` around it already
 * draws one. A separate client component, so `Button` itself stays usable —
 * and `buttonClass` callable — from server components.
 */
export function ButtonBusyOverlay({ label }: { label: string }) {
  return use(BusyScope) ? null : <BusyOverlay label={label} />;
}

/**
 * The whole screen, blurred, with one centred spinner and what is happening —
 * as a phone app does while it saves (2026-10-04). It sits over everything,
 * so nothing behind it can be pressed until the write is done.
 *
 * A modal `<dialog>` lives in the browser's top layer, above anything in
 * `<body>`; inside one, the overlay is drawn into that dialog instead, where
 * `fixed` still means the whole viewport.
 */
export function BusyOverlay({ label }: { label: string }) {
  // `null` on the server, the host on the client: the two renders agree.
  const host = useSyncExternalStore(noChange, overlayHost, () => null);
  if (!host) return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      // A portal still bubbles React events to its owner — a button, a dialog
      // that closes on a backdrop press. A press here is nobody's.
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      className="fixed inset-0 z-[100] grid animate-in place-items-center bg-surface/50 backdrop-blur-sm"
    >
      <div className="flex min-w-36 flex-col items-center gap-3 rounded-overlay bg-surface-raised px-6 py-5 shadow-overlay">
        <CircleNotch
          aria-hidden
          weight="bold"
          className="size-10 animate-spin text-accent motion-reduce:animate-none"
        />
        <span className="text-body font-medium text-ink">{label}</span>
      </div>
    </div>,
    host,
  );
}

/** The topmost open modal dialog, else the page. */
function overlayHost(): HTMLElement {
  const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
  return dialogs[dialogs.length - 1] ?? document.body;
}

/** The host is read when the overlay mounts; nothing re-reads it after. */
function noChange(): () => void {
  return () => undefined;
}
