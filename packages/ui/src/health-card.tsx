import type { ComponentProps, ReactNode } from "react";

import { cn } from "./cn";
import { flatSurfaceClass, iconTone, type IconTone } from "./layout";

/**
 * A small flat card for one thing's state (ADR-0015): an icon and a title, a
 * soft pill for its standing, a thin meter, and a line of detail. S-07's
 * sectors, S-20's "against expected", S-19's handovers.
 *
 *   <HealthCard.Root>
 *     <HealthCard.Header icon={<MapTrifold />} title="North" value={<Badge shape="pill">Tallied</Badge>} />
 *     <Meter … />
 *     <HealthCard.Detail>₹1,350.00 of ₹1,400.00</HealthCard.Detail>
 *   </HealthCard.Root>
 */

function Root({ className, ...props }: ComponentProps<"article">) {
  return (
    <article
      className={cn(flatSurfaceClass, "flex flex-col gap-3 p-4", className)}
      {...props}
    />
  );
}

function Header({
  icon,
  tone = "neutral",
  title,
  subtitle,
  value,
}: {
  icon?: ReactNode;
  tone?: IconTone;
  title: ReactNode;
  subtitle?: ReactNode;
  /** A `Badge shape="pill"` at the right: the card's standing. */
  value?: ReactNode;
}) {
  return (
    <header className="flex items-start gap-3">
      {icon ? (
        <span
          aria-hidden
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-tile [&_svg]:size-[18px]",
            iconTone[tone],
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="truncate text-label text-ink">{title}</h3>
        {subtitle ? (
          <p className="truncate text-caption text-ink-muted">{subtitle}</p>
        ) : null}
      </div>
      {value ? <div className="shrink-0">{value}</div> : null}
    </header>
  );
}

function Detail({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn("text-caption text-ink-muted", className)}
      data-numeric
      {...props}
    />
  );
}

export const HealthCard = { Root, Header, Detail };
