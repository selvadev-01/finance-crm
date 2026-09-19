"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Children,
  cloneElement,
  type ComponentProps,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useId,
} from "react";
import {
  type Control,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
  FormProvider,
  get,
  type Resolver,
  type SubmitHandler,
  useController,
  useForm,
  useFormContext,
  useFormState,
  type UseFormProps,
  type UseFormReturn,
} from "react-hook-form";
import type { z } from "zod";

import { Button, type ButtonVariants } from "./button";
import { cn } from "./cn";
import { Dialog, DialogActions, type DialogProps } from "./dialog";
import { validationMessage } from "./field-message";
import { FormMessage } from "./form-message";

/**
 * The form layer (ADR-0013): react-hook-form over the contract's own zod
 * schema, so the browser checks exactly what the API will check.
 *
 * - Errors show at the field when it is left (`mode: "onTouched"`), then
 *   update as the person types — the S-04/S-10 throughput rule.
 * - On submit, the first invalid field takes focus.
 * - Text controls are registered, not controlled, so a long form does not
 *   re-render on every keystroke.
 * - A failed write puts the API's field errors on the fields and the rest in
 *   `root.server` (apps/web `applyWriteFailure`).
 */

type AnySchema = z.ZodType<FieldValues, FieldValues>;

export type ZodForm<Schema extends AnySchema> = UseFormReturn<
  z.input<Schema>,
  unknown,
  z.output<Schema>
>;

export function useZodForm<Schema extends AnySchema>(
  schema: Schema,
  options: Omit<
    UseFormProps<z.input<Schema>, unknown, z.output<Schema>>,
    "resolver"
  > = {},
): ZodForm<Schema> {
  // zodResolver infers its input and output from a concrete schema; through
  // the generic `Schema` it widens to FieldValues, so it is narrowed back
  // here. The runtime is the same either way.
  const resolver = zodResolver(schema) as unknown as Resolver<
    z.input<Schema>,
    unknown,
    z.output<Schema>
  >;
  return useForm<z.input<Schema>, unknown, z.output<Schema>>({
    resolver,
    mode: "onTouched",
    shouldFocusError: true,
    ...options,
  });
}

interface FormProps<Input extends FieldValues, Output> extends Omit<
  ComponentProps<"form">,
  "onSubmit" | "noValidate"
> {
  form: UseFormReturn<Input, unknown, Output>;
  onSubmit: SubmitHandler<Output>;
}

/**
 * A `<form>` wired to its react-hook-form instance. The browser's own
 * validation is off — its bubbles cannot be styled, read out of order, and
 * disagree with the contract.
 */
export function Form<Input extends FieldValues, Output>({
  form,
  onSubmit,
  className,
  children,
  ...props
}: FormProps<Input, Output>) {
  return (
    <FormProvider {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn("flex flex-col gap-[var(--stack-gap)]", className)}
        {...props}
      >
        {children}
      </form>
    </FormProvider>
  );
}

/* ------------------------------------------------------------------------- */

interface FieldFrameProps {
  label: string;
  hint?: ReactNode;
  className?: string;
}

function useFieldError(
  name: string,
  label: string,
  rewrite?: (message: string) => string,
) {
  const { getValues } = useFormContext();
  const { errors } = useFormState({ name });
  const error = get(errors, name) as
    { type?: string; message?: string } | undefined;
  if (!error) return undefined;
  // An empty field is "required", whatever the schema's own code says — an
  // empty id otherwise reads as "invalid UUID". A server message is kept.
  const value: unknown = getValues(name);
  if (
    error.type !== "server" &&
    (value === "" || value === undefined || value === null)
  ) {
    return `${label} is required.`;
  }
  return validationMessage(
    label,
    rewrite && error.message
      ? { ...error, message: rewrite(error.message) }
      : error,
  );
}

const VALUE_AS = {
  /** Names and notes: surrounding spaces are not part of the value. */
  trimmed: (value: unknown) =>
    typeof value === "string" ? value.trim() : value,
  /** An optional field left empty is absent, not an empty string. */
  optional: (value: unknown) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
};

function FieldFrame({
  id,
  label,
  hint,
  error,
  className,
  children,
}: FieldFrameProps & { id: string; error?: string; children: ReactNode }) {
  const messageId = `${id}-message`;
  const message = error ?? hint;
  return (
    <div className={cn("flex flex-col gap-[var(--field-gap)]", className)}>
      <label htmlFor={id} className="text-label text-ink">
        {label}
      </label>
      {children}
      {message ? (
        <p
          id={messageId}
          className={cn(
            "text-caption",
            error ? "text-critical" : "text-ink-muted",
          )}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

type NativeControl = ReactElement<{
  id?: string;
  name?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}>;

/**
 * A label, one text-like control (`Input`, `Select`, `Textarea`) and its
 * hint or error, registered under `name`. Nested paths work:
 * `name="references.0.mobile"`.
 *
 *   <FormField name="name" label="Customer name"><Input autoComplete="off" /></FormField>
 */
export function FormField<Values extends FieldValues>({
  name,
  label,
  hint,
  className,
  children,
  valueAs,
  rewrite,
}: FieldFrameProps & {
  name: FieldPath<Values>;
  children: NativeControl;
  /** How the typed text is read: `trimmed`, or `optional` (empty → absent). */
  valueAs?: keyof typeof VALUE_AS;
  /** Rewords a schema message for this field before it is shown. */
  rewrite?: (message: string) => string;
}) {
  const id = useId();
  const { register } = useFormContext<Values>();
  const error = useFieldError(name, label, rewrite);
  const control = Children.only(children);
  const registration = register(
    name,
    valueAs ? { setValueAs: VALUE_AS[valueAs] } : {},
  );
  const message = error ?? hint;

  return (
    <FieldFrame
      id={id}
      label={label}
      hint={hint}
      error={error}
      className={className}
    >
      {isValidElement(control)
        ? cloneElement(control, {
            ...registration,
            id,
            "aria-describedby": message ? `${id}-message` : undefined,
            "aria-invalid": error ? true : undefined,
          })
        : control}
    </FieldFrame>
  );
}

/**
 * A field whose control is not a native input — `Combobox`, `Checkbox`,
 * `Switch`. The render function receives the value and change handler plus
 * the ids to put on the control. This is the one place a render prop is the
 * right shape: the control's props depend on the field's live state.
 *
 *   <FormControlField name="lineId" label="Line">
 *     {({ field, control }) => <Combobox {...control} value={field.value} onValueChange={field.onChange} options={…} />}
 *   </FormControlField>
 */
export function FormControlField<
  Values extends FieldValues,
  Name extends FieldPath<Values>,
>({
  name,
  label,
  hint,
  className,
  control: formControl,
  children,
}: FieldFrameProps & {
  name: Name;
  /** Only needed when the field is rendered outside `Form`. */
  control?: Control<Values>;
  children: (props: {
    field: ControllerRenderProps<Values, Name>;
    control: {
      id: string;
      "aria-describedby"?: string;
      "aria-invalid"?: boolean;
    };
  }) => ReactNode;
}) {
  const id = useId();
  const { field } = useController<Values, Name>({ name, control: formControl });
  const error = useFieldError(name, label);
  const message = error ?? hint;
  return (
    <FieldFrame
      id={id}
      label={label}
      hint={hint}
      error={error}
      className={className}
    >
      {children({
        field,
        control: {
          id,
          "aria-describedby": message ? `${id}-message` : undefined,
          "aria-invalid": error ? true : undefined,
        },
      })}
    </FieldFrame>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * The message about the whole form: a refusal from the API that belongs to
 * no field, or a warning that needs a decision ("Save anyway").
 * `applyWriteFailure` sets `root.server`; a type of `"warning"` shows amber.
 */
export function FormRootError({ action }: { action?: ReactNode }) {
  const { errors } = useFormState();
  const root = errors.root?.server;
  if (!root?.message) return null;
  return (
    <FormMessage
      tone={root.type === "warning" ? "warning" : "critical"}
      action={action}
    >
      {root.message}
    </FormMessage>
  );
}

/**
 * The action row at the foot of a page form: secondary first, commit last.
 *
 * On a phone it sticks to the bottom of the screen while the form scrolls
 * (docs/05-ux/stitch-mobile), so the commit button is never below the fold of
 * a long form. It sits on `--shell-bottom`, which the phone layout's shell sets
 * to its tab bar's height; with no tab bar it is the screen's edge.
 */
export function FormActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end",
        "max-sm:sticky max-sm:bottom-[var(--shell-bottom,0px)] max-sm:z-10 max-sm:-mx-[var(--page-padding)] max-sm:bg-surface-raised max-sm:px-[var(--page-padding)] max-sm:pb-3",
        // On a phone: the other actions share one row, and the commit button
        // (`SubmitButton` in its primary tone) takes the full row below them,
        // so the bar stays two rows high however many actions it holds.
        "max-sm:flex-row max-sm:flex-wrap max-sm:[&>*]:min-w-0 max-sm:[&>*]:flex-1 max-sm:[&>[data-commit]]:order-last max-sm:[&>[data-commit]]:basis-full",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The submit button: disabled, with its pending label, while the form submits. */
export function SubmitButton({
  children,
  pendingLabel,
  tone = "primary",
  className,
  name,
  value,
  onClick,
}: {
  children: ReactNode;
  /** "Saving…", "Creating…" — says what is happening. */
  pendingLabel: string;
  tone?: ButtonVariants["tone"];
  className?: string;
  /** Distinguishes two submit buttons, e.g. "Save" and "Save and add another". */
  name?: string;
  value?: string;
  onClick?: ComponentProps<"button">["onClick"];
}) {
  const { isSubmitting } = useFormState();
  return (
    <Button
      type="submit"
      tone={tone}
      disabled={isSubmitting}
      aria-busy={isSubmitting || undefined}
      className={className}
      name={name}
      value={value}
      onClick={onClick}
      // `FormActions` gives the form's one commit button a row of its own on a phone.
      data-commit={tone === "primary" ? "" : undefined}
    >
      {isSubmitting ? pendingLabel : children}
    </Button>
  );
}

/* ------------------------------------------------------------------------- */

interface DialogFormProps<Input extends FieldValues, Output> extends Pick<
  DialogProps,
  "title" | "description" | "size"
> {
  form: UseFormReturn<Input, unknown, Output>;
  onSubmit: SubmitHandler<Output>;
  onClose: () => void;
  submitLabel: string;
  pendingLabel: string;
  /** `danger` when submitting writes something off or reopens a closed day. */
  tone?: "primary" | "danger";
  children?: ReactNode;
}

/**
 * A dialog whose body is a form. It refuses to close while the write is in
 * flight, shows the form-level error above its actions, and draws Cancel and
 * the commit button itself — the boilerplate every console dialog repeated.
 */
export function DialogForm<Input extends FieldValues, Output>({
  form,
  onSubmit,
  onClose,
  title,
  description,
  size,
  submitLabel,
  pendingLabel,
  tone = "primary",
  children,
}: DialogFormProps<Input, Output>) {
  const submitting = form.formState.isSubmitting;
  return (
    <Dialog
      open
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={title}
      description={description}
      size={size}
    >
      <Form form={form} onSubmit={onSubmit}>
        {children}
        <FormRootError />
        <DialogActions>
          <Button tone="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <SubmitButton tone={tone} pendingLabel={pendingLabel}>
            {submitLabel}
          </SubmitButton>
        </DialogActions>
      </Form>
    </Dialog>
  );
}
