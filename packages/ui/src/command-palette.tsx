"use client";

import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { Command } from "cmdk";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { cn } from "./cn";
import { useBackdropPress } from "./dialog";
import { PortalContainerContext } from "./portal-container";

/**
 * A command palette: one search field over several kinds of record, opened from
 * the topbar or by a keyboard shortcut.
 *
 * Built on the native `<dialog>` like `Dialog`, for the same reasons —
 * `showModal()` gives focus trapping, `Escape`, the inert page behind and the
 * top layer without a focus-trap library. It is a separate component rather
 * than a `Dialog` with a field in it because the field *is* the header: there
 * is no title bar and no close button to reach for, and it sits near the top of
 * the screen rather than centred, where the eye already is after pressing the
 * trigger in the topbar.
 *
 * **Filtering is the caller's job.** `shouldFilter` is off, because the results
 * come back from the API already matched and re-sorting them in the browser
 * would fight the server's ordering. Whatever children are rendered are what is
 * shown, in the order given.
 *
 * Controlled, like `Dialog`: the screen owns `open` and `query`, and every way
 * of dismissing goes through `onClose`.
 */
export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** The search text. The caller debounces before it queries. */
  query: string;
  onQueryChange: (query: string) => void;
  /** Names what can be found here, for the screen reader and the field. */
  label: string;
  placeholder?: string;
  children: ReactNode;
}

export function CommandPalette({
  open,
  onClose,
  query,
  onQueryChange,
  label,
  placeholder = "Search…",
  children,
}: CommandPaletteProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // Also held in state so floating layers inside re-render into it once it
  // exists (portal-container.tsx), exactly as `Dialog` does.
  const [element, setElement] = useState<HTMLDialogElement | null>(null);
  const attach = useCallback((node: HTMLDialogElement | null) => {
    ref.current = node;
    setElement(node);
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const backdropPress = useBackdropPress(onClose);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    // The palette is usually unmounted rather than set back to `open: false`,
    // and removing an open <dialog> skips the focus return `close()` would do —
    // so remember the opener and hand focus back ourselves.
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!dialog.open) dialog.showModal();
    // `showModal()` moves focus to the dialog itself, undoing React's
    // `autoFocus`, which ran when the input mounted — a beat earlier. The
    // palette is a search box, so the caret belongs in it either way.
    inputRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={attach}
      aria-labelledby={labelId}
      {...backdropPress}
      className={cn(
        // Near the top rather than centred: the trigger is in the topbar, and
        // the list grows downwards into empty space instead of shifting the
        // field as results arrive.
        "mx-auto mt-[12vh] mb-auto w-[min(34rem,calc(100vw-2rem))] max-h-[min(28rem,calc(100dvh-16vh))]",
        "overflow-hidden rounded-overlay border border-border bg-surface-raised p-0 text-ink shadow-overlay",
        "open:animate-in backdrop:bg-ink/35",
      )}
    >
      <PortalContainerContext value={element}>
        <Command
          shouldFilter={false}
          // Escape and the arrow keys belong to the list; Escape closes.
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          className="flex max-h-[inherit] flex-col"
        >
          <div className="flex items-center gap-2.5 border-b border-border px-3.5">
            <MagnifyingGlass
              aria-hidden
              size={18}
              className="shrink-0 text-ink-subtle"
            />
            <Command.Input
              ref={inputRef}
              value={query}
              onValueChange={onQueryChange}
              aria-label={label}
              placeholder={placeholder}
              maxLength={80}
              className="h-12 w-full min-w-0 bg-transparent text-body text-ink outline-none placeholder:text-ink-subtle"
            />
          </div>
          <span id={labelId} className="sr-only">
            {label}
          </span>
          <Command.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
            {children}
          </Command.List>
        </Command>
      </PortalContainerContext>
    </dialog>
  );
}

/** A titled run of results — "Customers", "Accounts", "Go to". */
function PaletteGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Command.Group
      heading={title}
      className={cn(
        "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1",
        "[&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:text-ink-subtle",
      )}
    >
      {children}
    </Command.Group>
  );
}

/**
 * One result. `icon` carries the kind, `label` the name and `hint` whatever
 * identifies it — a code, a line, a role. `meta` is right-aligned for a status
 * or an amount, which is why it takes a node rather than a string: money is
 * formatted by the caller and never becomes a number here.
 */
function PaletteItem({
  value,
  onSelect,
  icon,
  label,
  hint,
  meta,
}: {
  /** Unique within the palette; cmdk keys its selection on it. */
  value: string;
  onSelect: () => void;
  icon?: ReactNode;
  label: string;
  hint?: string;
  meta?: ReactNode;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        "flex min-h-11 cursor-default items-center gap-3 rounded-control px-2 py-1.5 text-body text-ink select-none",
        "data-[selected=true]:bg-accent-subtle",
      )}
    >
      {icon ? (
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-tile bg-surface-sunken text-ink-muted"
        >
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{label}</span>
        {hint ? (
          <span className="truncate text-caption text-ink-muted">{hint}</span>
        ) : null}
      </span>
      {meta ? (
        <span className="shrink-0 text-caption text-ink-muted">{meta}</span>
      ) : null}
    </Command.Item>
  );
}

/**
 * What stands in for the list: the prompt before anything is typed, the
 * in-flight state, a failure, or nothing found. One component, because all four
 * occupy the same place and only one is ever shown.
 */
function PaletteMessage({ children }: { children: ReactNode }) {
  return (
    <p
      className="px-3 py-10 text-center text-body text-ink-muted"
      role="status"
    >
      {children}
    </p>
  );
}

CommandPalette.Group = PaletteGroup;
CommandPalette.Item = PaletteItem;
CommandPalette.Message = PaletteMessage;
