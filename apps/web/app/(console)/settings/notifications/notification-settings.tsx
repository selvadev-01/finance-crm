"use client";

import {
  type NotificationCategory,
  notificationContract,
} from "@repo/contracts";
import {
  Card,
  Choice,
  FormMessage,
  ListSkeleton,
  PageHeader,
  Section,
  Switch,
} from "@repo/ui";
import { useState } from "react";

import { LoadFailed } from "../../../../components/query-state";
import { apiWrite } from "../../../../lib/api-write";
import { CATEGORY_LABEL } from "../../../../lib/notifications/notification-list";
import { CONSOLE_PUSH_WORKER } from "../../../../lib/notifications/push";
import { PushToggle } from "../../../../lib/notifications/push-toggle";
import { useApiQuery } from "../../../../lib/use-api-query";

const CATEGORY_HINT: Record<NotificationCategory, string> = {
  ALERT:
    "Low and no-payment collections, missed customers, disputes, cash discrepancies. Always on.",
  WARNING: "Extra collections, corrections to approve, reopened days.",
  SUCCESS: "Accounts completed.",
  INFORMATION: "New assignments and handovers sent to you.",
};

/**
 * The Notifications tab of Settings: this device's push switch (US-071) and
 * the reader's own categories (US-073). Every console role has it — the
 * categories are per user, not per organisation.
 *
 * The notifications themselves are in the bell's panel, not here
 * (`notification-panel.tsx`).
 */
export function NotificationSettings() {
  const preferences = useApiQuery(notificationContract.getPreferences, {});
  const [saving, setSaving] = useState<NotificationCategory | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function setCategory(category: NotificationCategory, enabled: boolean) {
    setSaving(category);
    const result = await apiWrite(notificationContract.updatePreferences, {
      body: { categories: [{ category, enabled }] },
    });
    setProblem(
      result.ok ? null : (result.form ?? "Could not save. Try again."),
    );
    setSaving(null);
    preferences.reload();
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Where Rasi reaches you, and what it reaches you about. The bell always shows everything — these choose what also buzzes a device."
      />

      <Section title="On this device">
        <PushToggle
          worker={CONSOLE_PUSH_WORKER}
          deviceLabel="Console browser"
        />
      </Section>

      <Section title="What to notify me about">
        {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
        {preferences.status === "loading" ? (
          <ListSkeleton columns={1} rows={4} />
        ) : null}
        {preferences.status === "error" ? (
          <LoadFailed
            message={preferences.message}
            onRetry={preferences.reload}
          />
        ) : null}
        {preferences.status === "ready" ? (
          <Card.Root>
            <ul className="flex flex-col divide-y divide-border">
              {preferences.data.categories.map((item) => (
                <li key={item.category} className="px-4 py-3">
                  <Choice
                    label={`${CATEGORY_LABEL[item.category]}${item.pushed ? " · pushed to devices" : ""}${item.emailed ? " · emailed" : ""}`}
                    description={CATEGORY_HINT[item.category]}
                  >
                    <Switch
                      checked={item.enabled}
                      disabled={item.locked || saving !== null}
                      onCheckedChange={(enabled) =>
                        void setCategory(item.category, enabled)
                      }
                    />
                  </Choice>
                </li>
              ))}
            </ul>
          </Card.Root>
        ) : null}
      </Section>
    </>
  );
}
