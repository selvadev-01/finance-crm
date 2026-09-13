import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useId,
} from "react";

import { cn } from "./cn";

/**
 * A label, one control, and its hint or error — wired together for assistive
 * technology so no screen has to remember to do it.
 *
 * The control is passed as the single child; `Field` gives it an `id`,
 * `aria-describedby` pointing at the hint or error, and `aria-invalid` while an
 * error is shown. An error replaces the hint rather than stacking under it: two
 * lines of grey and red under one input is noise.
 *
 * Errors are shown at the field (throughput pass, backlog Phase 6) — inline,
 * next to what caused them, not in a summary at the top.
 */
export interface FieldProps {
  label: string;
  /** Guidance shown while there is no error. */
  hint?: string;
  error?: string;
  /** Exactly one control: `Input`, or anything accepting id and aria props. */
  children: ReactElement<{
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }>;
  className?: string;
}

export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message: ReactNode = error ?? hint;
  const control = Children.only(children);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {isValidElement(control)
        ? cloneElement(control, {
            id,
            "aria-describedby": message ? messageId : undefined,
            "aria-invalid": error ? true : undefined,
          })
        : control}
      {message ? (
        <p
          id={messageId}
          className={cn("text-sm", error ? "text-critical" : "text-ink-muted")}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
