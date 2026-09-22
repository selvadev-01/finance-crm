import { cn } from "@repo/ui";
import type { ReactNode } from "react";

/** 56px fields and a pill submit button on a phone; the usual size above. */
const PHONE_CONTROLS =
  "max-sm:[&_input:not([type=checkbox])]:h-14 max-sm:[&_input:not([type=checkbox])]:rounded-surface max-sm:[&_button[type=submit]]:h-14 max-sm:[&_button[type=submit]]:rounded-pill max-sm:[&_button[type=submit]]:text-base max-sm:[&_button[type=submit]]:font-semibold";

/**
 * The one card every sign-in and password screen sits in: a title, an
 * optional line saying what to do, the form, and an optional footer link.
 *
 * On a phone it is the page itself (J-00): no border, and controls a thumb
 * cannot miss. From `sm` up it is a card at the ordinary control size.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-6 sm:rounded-surface sm:border sm:border-border sm:bg-surface-raised sm:p-6 sm:shadow-raised",
        PHONE_CONTROLS,
      )}
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-display text-ink sm:text-title">{title}</h1>
        {description ? (
          <p className="text-body text-ink-muted">{description}</p>
        ) : null}
      </header>
      {children}
      {footer ? <p className="text-body text-ink-muted">{footer}</p> : null}
    </section>
  );
}
