import type { ComponentProps, ReactNode } from "react";

import { cn } from "./cn";
import { iconTone, type IconTone } from "./layout";

/**
 * A list of things that happened or need doing, each led by a tinted icon
 * square (ADR-0015) — S-20's "Needs attention".
 *
 *   <ActivityList.Root aria-label="Needs attention">
 *     <ActivityList.Item>
 *       <ActivityList.Icon tone="critical"><Warning /></ActivityList.Icon>
 *       <ActivityList.Body title="Handover disputed" meta="Line 7 · ₹200.00 short" />
 *       <ActivityList.Aside><Link …>Review</Link></ActivityList.Aside>
 *     </ActivityList.Item>
 *   </ActivityList.Root>
 */

function Root({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      className={cn("flex flex-col divide-y divide-border/70", className)}
      {...props}
    />
  );
}

function Item({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0",
        className,
      )}
      {...props}
    />
  );
}

function Icon({ tone, children }: { tone: IconTone; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-tile sm:size-14 [&_svg]:size-5 sm:[&_svg]:size-6",
        iconTone[tone],
      )}
    >
      {children}
    </span>
  );
}

function Body({
  title,
  meta,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
      <p className="text-label text-ink">{title}</p>
      {meta ? <p className="text-caption text-ink-muted">{meta}</p> : null}
      {children}
    </div>
  );
}

function Aside({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex shrink-0 items-center gap-3", className)}
      {...props}
    />
  );
}

export const ActivityList = { Root, Item, Icon, Body, Aside };
