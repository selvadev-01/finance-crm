/**
 * The frame every text-like control shares — `Input`, `Textarea`, `Select`
 * and the combobox trigger — so they cannot drift apart.
 *
 * Focus is the accent border plus a soft ring, shown on any focus (not only
 * keyboard focus): someone clicking into a field still needs to see where the
 * caret went. Invalid state is `aria-invalid`, the same attribute a screen
 * reader announces, so the two can never disagree.
 */
export const controlFrame = [
  "block w-full min-w-0 rounded-control border border-border-strong bg-surface-raised text-ink",
  "text-[length:var(--control-font-size)]",
  "placeholder:text-ink-subtle",
  "transition-[border-color,box-shadow] duration-150",
  "hover:border-ink-subtle",
  "focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none",
  "aria-invalid:border-critical aria-invalid:focus:ring-critical/15",
  "disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-sunken disabled:text-ink-muted",
].join(" ");
