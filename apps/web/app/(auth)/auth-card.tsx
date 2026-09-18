import type { ReactNode } from "react";

/**
 * The one card every sign-in and password screen sits in: a title, an
 * optional line saying what to do, the form, and an optional footer link.
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
    <section className="flex flex-col gap-6 rounded-surface border border-border bg-surface-raised p-6 shadow-raised">
      <header className="flex flex-col gap-1">
        <h1 className="text-title text-ink">{title}</h1>
        {description ? (
          <p className="text-body text-ink-muted">{description}</p>
        ) : null}
      </header>
      {children}
      {footer ? <p className="text-body text-ink-muted">{footer}</p> : null}
    </section>
  );
}
