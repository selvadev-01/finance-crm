"use client";

import {
  CheckCircle,
  Info,
  WarningCircle,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { Toast as RadixToast } from "radix-ui";
import { useSyncExternalStore } from "react";

import { cn } from "./cn";

export interface ToastInput {
  tone?: "positive" | "critical" | "info";
  title: string;
  description?: string;
}

interface ToastEntry extends Required<Pick<ToastInput, "tone" | "title">> {
  id: number;
  description?: string;
}

/**
 * A tiny module-level store: `toast()` can be called from an event handler
 * anywhere — after a save, after a sync — without threading a context
 * through. `Toaster` is the only subscriber.
 */
let entries: ToastEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(next: ToastEntry[]) {
  entries = next;
  for (const listener of listeners) listener();
}

/**
 * Confirm something that happened out of sight of where the person is
 * looking: "Line LN-07 created", "Password reset". Not for errors a person
 * must act on — those stay on the form, next to what caused them.
 */
export function toast({
  tone = "positive",
  title,
  description,
}: ToastInput): void {
  emit([...entries, { id: nextId++, tone, title, description }].slice(-3));
}

function dismiss(id: number) {
  emit(entries.filter((entry) => entry.id !== id));
}

const EMPTY: ToastEntry[] = [];

function useToasts(): ToastEntry[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => entries,
    () => EMPTY,
  );
}

const ICON = {
  positive: { Icon: CheckCircle, className: "text-positive" },
  critical: { Icon: WarningCircle, className: "text-critical" },
  info: { Icon: Info, className: "text-info" },
} as const;

/**
 * Mount once per surface. Radix gives the region its live-region semantics,
 * swipe-to-dismiss and F8 to reach it from the keyboard. A critical toast is
 * announced assertively and stays until dismissed.
 *
 * Toasts render at `<body>`: while a modal `Dialog` is open they sit behind
 * its backdrop. Raise them after the dialog closes, which is when a save
 * confirmation belongs anyway.
 */
export function Toaster() {
  const toasts = useToasts();
  return (
    <RadixToast.Provider swipeDirection="right" label="Notification">
      {toasts.map((entry) => {
        const { Icon, className } = ICON[entry.tone];
        const critical = entry.tone === "critical";
        return (
          <RadixToast.Root
            key={entry.id}
            type={critical ? "foreground" : "background"}
            duration={critical ? Number.POSITIVE_INFINITY : 5000}
            onOpenChange={(open) => {
              if (!open) dismiss(entry.id);
            }}
            className={cn(
              "flex items-start gap-3 rounded-control border border-border bg-surface-overlay p-3 shadow-popover",
              "data-[state=open]:animate-in data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x)",
              "data-[swipe=end]:translate-x-(--radix-toast-swipe-end-x) data-[state=closed]:opacity-0",
              "transition-opacity",
            )}
          >
            <Icon
              aria-hidden
              size={18}
              className={cn("mt-px shrink-0", className)}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <RadixToast.Title className="text-label text-ink">
                {entry.title}
              </RadixToast.Title>
              {entry.description ? (
                <RadixToast.Description className="text-caption text-ink-muted">
                  {entry.description}
                </RadixToast.Description>
              ) : null}
            </div>
            <RadixToast.Close
              aria-label="Dismiss"
              className="-m-1 rounded-sm p-1 text-ink-muted hover:bg-surface-sunken hover:text-ink"
            >
              <X aria-hidden size={14} />
            </RadixToast.Close>
          </RadixToast.Root>
        );
      })}
      <RadixToast.Viewport className="fixed right-0 bottom-0 z-[60] flex w-full max-w-sm flex-col gap-2 p-4 outline-none" />
    </RadixToast.Provider>
  );
}
