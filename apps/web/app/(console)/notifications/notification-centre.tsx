"use client";

import {
  type NotificationCategory,
  notificationContract,
} from "@repo/contracts";
import {
  Button,
  DataTableSkeleton,
  NoMatches,
  NothingYet,
  PageHeader,
} from "@repo/ui";
import { useState } from "react";

import { apiWrite } from "../../../lib/api-write";
import {
  CATEGORY_LABEL,
  markAllRead,
  NotificationList,
} from "../../../lib/notifications/notification-list";
import { CONSOLE_PUSH_WORKER } from "../../../lib/notifications/push";
import { PushToggle } from "../../../lib/notifications/push-toggle";
import { useApiQuery } from "../../../lib/use-api-query";
import { LoadFailed } from "../_organisation/list-controls";

const CATEGORY_HINT: Record<NotificationCategory, string> = {
  ALERT:
    "Low and no-payment collections, missed customers, disputes, cash discrepancies. Always on.",
  WARNING: "Extra collections, corrections to approve, reopened days.",
  SUCCESS: "Accounts completed.",
  INFORMATION: "New assignments and handovers sent to you.",
};

/**
 * S-21, the notification centre, in the console (US-070): newest first,
 * unread or all, mark read; with this device's push switch (US-071) and the
 * user's categories (US-073).
 */
export function NotificationCentre() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useApiQuery(notificationContract.listNotifications, {
    query: { limit: 50, ...(unreadOnly ? { unread: "true" as const } : {}) },
  });
  const preferences = useApiQuery(notificationContract.getPreferences, {});
  const [saving, setSaving] = useState<NotificationCategory | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const unread = list.status === "ready" ? list.data.unreadCount : 0;

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
        description={
          list.status === "ready"
            ? `${unread} unread`
            : "What needs your attention."
        }
        actions={
          <>
            <Button
              tone="secondary"
              aria-pressed={unreadOnly}
              onClick={() => setUnreadOnly((value) => !value)}
            >
              {unreadOnly ? "Show all" : "Unread only"}
            </Button>
            <Button
              tone="secondary"
              disabled={unread === 0}
              onClick={async () => {
                await markAllRead();
                list.reload();
              }}
            >
              Mark all read
            </Button>
          </>
        }
      />

      <section className="flex flex-col gap-3" aria-label="Notifications">
        {list.status === "loading" ? (
          <DataTableSkeleton columns={1} rows={4} />
        ) : null}
        {list.status === "error" ? (
          <LoadFailed message={list.message} onRetry={list.reload} />
        ) : null}
        {list.status === "ready" ? (
          list.data.data.length === 0 ? (
            unreadOnly ? (
              <NoMatches
                title="Nothing unread"
                description="You have read every notification."
                action={
                  <Button tone="secondary" onClick={() => setUnreadOnly(false)}>
                    Show all
                  </Button>
                }
              />
            ) : (
              <NothingYet
                title="No notifications yet"
                description="Alerts about your lines, cash and approvals appear here."
              />
            )
          ) : (
            <NotificationList
              notifications={list.data.data}
              linkable
              onChanged={list.reload}
            />
          )
        ) : null}
        {list.status === "ready" && list.data.hasMore ? (
          <p className="text-sm text-ink-muted">Showing the latest 50.</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-ink">On this device</h2>
        <PushToggle
          worker={CONSOLE_PUSH_WORKER}
          deviceLabel="Console browser"
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-ink">
          What to notify me about
        </h2>
        {problem ? (
          <p role="alert" className="text-sm text-critical">
            {problem}
          </p>
        ) : null}
        {preferences.status === "error" ? (
          <LoadFailed
            message={preferences.message}
            onRetry={preferences.reload}
          />
        ) : null}
        {preferences.status === "ready" ? (
          <ul className="flex flex-col gap-2">
            {preferences.data.categories.map((item) => (
              <li
                key={item.category}
                className="flex items-start gap-3 rounded-[var(--radius-surface)] border border-border bg-surface-raised px-4 py-3"
              >
                <input
                  id={`category-${item.category}`}
                  type="checkbox"
                  className="mt-1 size-4 accent-[var(--color-accent)]"
                  checked={item.enabled}
                  disabled={item.locked || saving !== null}
                  onChange={(event) =>
                    void setCategory(item.category, event.target.checked)
                  }
                />
                <label
                  htmlFor={`category-${item.category}`}
                  className="flex flex-col gap-0.5"
                >
                  <span className="text-sm font-medium text-ink">
                    {CATEGORY_LABEL[item.category]}
                    {item.pushed ? " · pushed to devices" : ""}
                    {item.emailed ? " · emailed" : ""}
                  </span>
                  <span className="text-sm text-ink-muted">
                    {CATEGORY_HINT[item.category]}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
}
