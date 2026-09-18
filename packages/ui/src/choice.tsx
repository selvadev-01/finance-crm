"use client";

import { Check, Minus } from "@phosphor-icons/react/dist/ssr";
import { Checkbox as RadixCheckbox, Switch as RadixSwitch } from "radix-ui";
import {
  Children,
  cloneElement,
  type ComponentProps,
  isValidElement,
  type ReactElement,
  useId,
} from "react";

import { cn } from "./cn";

/**
 * A checkbox. Controlled with `checked` / `onCheckedChange`, like every Radix
 * control; `checked="indeterminate"` draws the dash.
 *
 * Use it for a choice that is applied when a form is saved. For a setting that
 * takes effect the moment it is flipped — a notification preference, "show
 * inactive" — use `Switch`.
 */
export function Checkbox({
  className,
  ...props
}: ComponentProps<typeof RadixCheckbox.Root>) {
  return (
    <RadixCheckbox.Root
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-sm border border-border-strong bg-surface-raised",
        "transition-colors hover:border-ink-subtle",
        "data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-ink",
        "data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-accent-ink",
        "aria-invalid:border-critical disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadixCheckbox.Indicator className="grid place-items-center">
        {props.checked === "indeterminate" ? (
          <Minus aria-hidden size={12} weight="bold" />
        ) : (
          <Check aria-hidden size={12} weight="bold" />
        )}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}

/** An on/off setting that takes effect immediately. */
export function Switch({
  className,
  ...props
}: ComponentProps<typeof RadixSwitch.Root>) {
  return (
    <RadixSwitch.Root
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-pill border border-transparent bg-border-strong p-px",
        "transition-colors data-[state=checked]:bg-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadixSwitch.Thumb
        className={cn(
          "block size-4 rounded-pill bg-surface-raised shadow-raised",
          "transition-transform data-[state=checked]:translate-x-4",
        )}
      />
    </RadixSwitch.Root>
  );
}

export interface ChoiceProps {
  label: string;
  /** A second line under the label — what turning it on does. */
  description?: string;
  /** Exactly one `Checkbox` or `Switch`. */
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
  className?: string;
}

/**
 * A checkbox or switch with its label beside it, the whole row clickable.
 * `Field` stacks a label above a text control; this is its sideways sibling.
 */
export function Choice({
  label,
  description,
  children,
  className,
}: ChoiceProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const control = Children.only(children);

  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <div className="flex h-[1.25rem] items-center">
        {isValidElement(control)
          ? cloneElement(control, {
              id,
              "aria-describedby": description ? descriptionId : undefined,
            })
          : control}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-body text-ink">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-caption text-ink-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
