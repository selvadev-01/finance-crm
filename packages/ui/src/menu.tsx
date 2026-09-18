"use client";

import { DropdownMenu } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "./cn";
import { floatingSurface } from "./popover";
import { usePortalContainer } from "./portal-container";

/**
 * A menu of actions behind one trigger — the row actions of a record, the
 * signed-in person's menu. Arrow keys, type-ahead and Escape come from Radix.
 *
 * Only actions go in a menu. A destructive one uses `tone="danger"` and still
 * opens a confirming `Dialog` that names the consequence.
 */
function Content({
  className,
  align = "end",
  sideOffset = 6,
  ...props
}: ComponentProps<typeof DropdownMenu.Content>) {
  const container = usePortalContainer();
  return (
    <DropdownMenu.Portal container={container}>
      <DropdownMenu.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(floatingSurface, "min-w-44 p-1", className)}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

const item = cva(
  [
    "flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-body outline-none select-none",
    "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
    "[&_svg]:shrink-0",
  ],
  {
    variants: {
      tone: {
        default: "text-ink data-[highlighted]:bg-surface-sunken",
        danger: "text-critical data-[highlighted]:bg-critical-subtle",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

function Item({
  className,
  tone,
  ...props
}: ComponentProps<typeof DropdownMenu.Item> & VariantProps<typeof item>) {
  return (
    <DropdownMenu.Item className={cn(item({ tone }), className)} {...props} />
  );
}

function Label({
  className,
  ...props
}: ComponentProps<typeof DropdownMenu.Label>) {
  return (
    <DropdownMenu.Label
      className={cn(
        "flex flex-col px-2 py-1.5 text-caption text-ink-muted",
        className,
      )}
      {...props}
    />
  );
}

function Separator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenu.Separator>) {
  return (
    <DropdownMenu.Separator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export const Menu = {
  Root: DropdownMenu.Root,
  Trigger: DropdownMenu.Trigger,
  Group: DropdownMenu.Group,
  Content,
  Item,
  Label,
  Separator,
};
