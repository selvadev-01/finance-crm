"use client";

import { X } from "@phosphor-icons/react/dist/ssr";
import { cva, type VariantProps } from "class-variance-authority";
import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { cn } from "./cn";
import { PortalContainerContext } from "./portal-container";

/**
 * A modal dialog on the native `<dialog>` element.
 *
 * `showModal()` gives focus trapping, `Escape`, the inert page behind and the
 * top layer for free, so there is no focus-trap library to keep correct. Focus
 * returns to whatever opened it when it closes.
 *
 * Controlled: the screen owns `open`, and every way of dismissing — Escape,
 * the close button, a click on the backdrop — goes through `onClose`, so a
 * dialog with a pending request can refuse by ignoring it.
 *
 * For a destructive action, the title names the consequence ("Deactivate line
 * LN-07"), never "Are you sure?" (design-system.md).
 */
const dialogFrame = cva("", {
  variants: {
    size: {
      sm: "w-[min(24rem,calc(100vw-2rem))]",
      md: "w-[min(32rem,calc(100vw-2rem))]",
      lg: "w-[min(44rem,calc(100vw-2rem))]",
    },
    /**
     * `center` floats in the middle of the screen. `sheet` rises from the
     * foot, full width, for the phone layout (ADR-0016): the thumb is there.
     */
    placement: {
      center:
        "m-auto max-h-[calc(100dvh-2rem)] rounded-overlay border border-border",
      sheet:
        "mx-auto mt-auto mb-0 max-h-[85dvh] w-full max-w-3xl rounded-t-overlay border-t border-border pb-[env(safe-area-inset-bottom)]",
    },
  },
  compoundVariants: [
    // A sheet spans the screen, whatever size the dialog asked for.
    { placement: "sheet", className: "w-full" },
  ],
  defaultVariants: { size: "md", placement: "center" },
});

export interface DialogProps extends VariantProps<typeof dialogFrame> {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  size,
  placement,
  children,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // Also held in state, so floating layers inside re-render into it once it
  // exists (portal-container.tsx).
  const [element, setElement] = useState<HTMLDialogElement | null>(null);
  const attach = useCallback((node: HTMLDialogElement | null) => {
    ref.current = node;
    setElement(node);
  }, []);
  const titleId = useId();
  const descriptionId = useId();

  const backdropPress = useBackdropPress(onClose);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    // Screens usually unmount a dialog rather than set `open` to false, and
    // removing an open <dialog> skips the focus return `close()` would do —
    // so remember the opener and hand focus back ourselves.
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={attach}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        // Escape: let the screen decide, rather than closing behind its back.
        event.preventDefault();
        onClose();
      }}
      {...backdropPress}
      className={cn(
        dialogFrame({ size, placement }),
        "overflow-y-auto bg-surface-raised p-0 text-ink shadow-overlay",
        "open:animate-in backdrop:bg-ink/35",
        className,
      )}
    >
      <div className="flex flex-col gap-[var(--stack-gap)] p-5">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-heading text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-body text-ink-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-1.5 rounded-control p-1.5 text-ink-muted hover:bg-surface-sunken hover:text-ink"
          >
            <X aria-hidden size={18} weight="regular" />
          </button>
        </header>
        <PortalContainerContext value={element}>
          {children}
        </PortalContainerContext>
      </div>
    </dialog>
  );
}

/**
 * Closes on a press that both starts and ends on the backdrop (the `<dialog>`
 * element itself, outside its content). Checking only `click` would close the
 * dialog — and discard what was typed — when a text selection inside a field
 * is released past the dialog's edge, because `click` targets where the mouse
 * came up.
 */
export function useBackdropPress(onClose: () => void) {
  const pressStartedOnBackdrop = useRef(false);
  return {
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => {
      pressStartedOnBackdrop.current = event.target === event.currentTarget;
    },
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      const onBackdrop =
        pressStartedOnBackdrop.current && event.target === event.currentTarget;
      pressStartedOnBackdrop.current = false;
      if (onBackdrop) onClose();
    },
  };
}

/**
 * The row of actions at the foot of a dialog: cancel first, commit last. It
 * sits on a ruled footer band, bleeding to the dialog's edges, so the commit
 * button is always found in the same place.
 */
export function DialogActions({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-5 mt-1 -mb-5 flex flex-col-reverse gap-2 border-t border-border bg-surface-sunken px-5 py-3 sm:flex-row sm:justify-end">
      {children}
    </div>
  );
}
