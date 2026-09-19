"use client";

import { Desktop, DeviceMobile } from "@phosphor-icons/react/dist/ssr";
import { Badge, Button, cn, Dialog } from "@repo/ui";
import { useId, useState } from "react";

import {
  type DeviceLayout,
  saveLayout,
  suggestForThisScreen,
} from "../../lib/device-layout";
import { install } from "../../lib/install-prompt";

const OPTIONS: {
  layout: DeviceLayout;
  label: string;
  hint: string;
  icon: typeof Desktop;
}[] = [
  {
    layout: "mobile",
    label: "Phone",
    hint: "Tabs at the bottom, one column, large buttons for your thumb.",
    icon: DeviceMobile,
  },
  {
    layout: "desktop",
    label: "Computer",
    hint: "A sidebar and wide tables, for a mouse and keyboard.",
    icon: Desktop,
  },
];

/**
 * "How will you use Rasi on this device?" (ADR-0016). Shown before the
 * installed app first opens the console, before the browser's install dialog,
 * and from the account menu. Saving the answer switches the console at once.
 */
export function LayoutChooser({
  current,
  confirmLabel,
  onChosen,
}: {
  /** The layout in use now, if any: it starts selected instead of the suggestion. */
  current?: DeviceLayout | null;
  /** Overrides the button's wording, e.g. "Continue to install". */
  confirmLabel?: (layout: DeviceLayout) => string;
  onChosen?: (layout: DeviceLayout) => void;
}) {
  const [suggested] = useState(suggestForThisScreen);
  const [selected, setSelected] = useState<DeviceLayout>(current ?? suggested);
  const name = useId();

  function choose() {
    saveLayout(selected);
    onChosen?.(selected);
  }

  return (
    <div className="flex flex-col gap-[var(--stack-gap)]">
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Layout for this device</legend>
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const checked = selected === option.layout;
          return (
            <label
              key={option.layout}
              className={cn(
                "flex min-h-[var(--spacing-touch-lg)] cursor-pointer items-start gap-3 rounded-surface border bg-surface-raised p-4 transition-colors",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                checked
                  ? "border-accent bg-accent-subtle"
                  : "border-border hover:bg-surface-sunken",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.layout}
                checked={checked}
                onChange={() => setSelected(option.layout)}
                className="sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-tile",
                  checked
                    ? "bg-accent text-accent-ink"
                    : "bg-surface-sunken text-ink-muted",
                )}
              >
                <Icon size={22} />
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-2 text-heading text-ink">
                  {option.label}
                  {option.layout === suggested ? (
                    <Badge tone="neutral">Suggested</Badge>
                  ) : null}
                </span>
                <span className="text-body text-ink-muted">{option.hint}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <Button tone="primary" className="w-full" onClick={choose}>
        {confirmLabel
          ? confirmLabel(selected)
          : `Use the ${selected === "mobile" ? "phone" : "computer"} layout`}
      </Button>
      <p className="text-caption text-ink-subtle">
        This is kept on this device only. Change it any time from your account
        menu.
      </p>
    </div>
  );
}

/**
 * The chooser in a dialog. `switch` changes the layout in place; `install`
 * asks first, then opens the browser's own install dialog, so installing Rasi
 * begins with the question.
 */
export function LayoutDialog({
  purpose,
  current,
  placement,
  onClose,
}: {
  purpose: "switch" | "install";
  current: DeviceLayout | null;
  placement: "center" | "sheet";
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      placement={placement}
      title={
        purpose === "install"
          ? "Install Rasi on this device"
          : "Layout for this device"
      }
      description="How will you use Rasi here?"
    >
      <LayoutChooser
        current={current}
        confirmLabel={
          purpose === "install" ? () => "Continue to install" : undefined
        }
        onChosen={() => {
          onClose();
          if (purpose === "install") void install();
        }}
      />
    </Dialog>
  );
}
