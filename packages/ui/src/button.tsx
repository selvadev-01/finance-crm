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
 * `size="sm"` reads `--control-height-sm` instead, for toolbars and row
 * actions in the console; never for anything a Junior taps.
 */
const button = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap",
    "rounded-control font-medium",
    "transition-[color,background-color,border-color,box-shadow] duration-150",
    "disabled:pointer-events-none disabled:opacity-50",
    // Tactile press. Cheap, and it tells a gloved thumb the tap registered.
    "active:translate-y-px",
    "[&_svg]:shrink-0",
  ],
  {
    variants: {
      tone: {
        primary:
          "bg-accent text-accent-ink shadow-raised hover:bg-accent-hover",
        secondary:
          "border border-border bg-surface-raised text-ink shadow-raised hover:border-border-strong hover:bg-surface-sunken",
        ghost: "text-ink-muted hover:bg-surface-sunken hover:text-ink",
        danger:
          "bg-critical text-ink-inverse shadow-raised hover:bg-critical/90",
        /** Reads as a link but behaves as a button: "Clear filters", "Show all". */
        link: "h-auto! px-0! text-accent underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-[var(--control-height)] px-[var(--control-padding-x)] text-[length:var(--control-font-size)]",
        sm: "h-[var(--control-height-sm)] px-2.5 text-label",
      },
    },
    defaultVariants: { tone: "secondary", size: "default" },
  },
);

export type ButtonVariants = VariantProps<typeof button>;

export type ButtonProps = ComponentProps<"button"> & ButtonVariants;

/**
 * The button look for something that navigates — a Next `Link` styled as a
 * button, rather than a `<button>` wrapping an `<a>`, which nests two
 * interactive elements and confuses keyboard and screen-reader users.
 */
export function buttonClass(
  tone: ButtonVariants["tone"],
  className?: string,
  size?: ButtonVariants["size"],
): string {
  return cn(button({ tone, size }), className);
}

export function Button({ tone, size, className, type, ...props }: ButtonProps) {
  return (
    <button
      // Buttons inside a form default to submit, which has surprised every
      // developer at least once. Opt in explicitly instead.
      type={type ?? "button"}
      className={cn(button({ tone, size }), className)}
      {...props}
    />
  );
}
