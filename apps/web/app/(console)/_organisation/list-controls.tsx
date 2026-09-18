"use client";

import { Choice, Switch } from "@repo/ui";

/** "Show inactive" — inactive sectors and lines are hidden by default (M03). */
export function ShowInactiveToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex h-[var(--control-height)] items-center">
      <Choice label="Show inactive">
        <Switch checked={checked} onCheckedChange={onChange} />
      </Choice>
    </div>
  );
}
