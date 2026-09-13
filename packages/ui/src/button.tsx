import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "./cn";

/**
 * `tone` is a named set of intents, not a pile of booleans.
 *
 * `<Button primary danger>` is representable and meaningless; `tone="danger"`
 * is not. Every destructive action in Rasi writes off money or reopens a
 * closed day, so the difference has to be visible in the type as well as on
 * screen.
 *
 * Height comes from `--control-height`, which the density mode sets — so the
 * same Button is a 44px touch target in the Junior's field app and a 36px
 * control in the admin console, with no `dense` prop and no second component.
 */
const button = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-[var(--radius-control)] font-medium",
    "h-[var(--control-height)] px-[var(--control-padding-x)]",
    "text-[length:var(--control-font-size)]",
    "transition-colors",
    "disabled:pointer-events-none disabled:opacity-50",
    // Tactile press. Cheap, and it tells a gloved thumb the tap registered.
    "active:translate-y-px",
  ],
  {
    variants: {
      tone: {
        primary: "bg-accent text-accent-ink hover:bg-accent-hover",
        secondary:
          "border border-border-strong bg-surface-raised text-ink hover:bg-surface-sunken",
        ghost: "text-ink-muted hover:bg-surface-sunken hover:text-ink",
        danger: "bg-critical text-ink-inverse hover:brightness-95",
      },
    },
    defaultVariants: { tone: "secondary" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof button>;

/**
 * The button look for something that navigates — a Next `Link` styled as a
 * button, rather than a `<button>` wrapping an `<a>`, which nests two
 * interactive elements and confuses keyboard and screen-reader users.
 */
export function buttonClass(
  tone: VariantProps<typeof button>["tone"],
  className?: string,
): string {
  return cn(button({ tone }), className);
}

export function Button({ tone, className, type, ...props }: ButtonProps) {
  return (
    <button
      // Buttons inside a form default to submit, which has surprised every
      // developer at least once. Opt in explicitly instead.
      type={type ?? "button"}
      className={cn(button({ tone }), className)}
      {...props}
    />
  );
}
