"use client";

import {
  type NotificationCategory,
  notificationContract,
} from "@repo/contracts";
import {
  Button,
  Card,
  Choice,
  FormMessage,
  ListFooter,
  ListSkeleton,
  NoMatches,
  NothingYet,
  PageHeader,
  Section,
  Switch,
} from "@repo/ui";
import { useState } from "react";

import { ListFallback } from "../../../components/list-state";
import { LoadFailed } from "../../../components/query-state";
import { apiWrite } from "../../../lib/api-write";
import {
  CATEGORY_LABEL,
  markAllRead,
  NotificationList,
} from "../../../lib/notifications/notification-list";
import { CONSOLE_PUSH_WORKER } from "../../../lib/notifications/push";
import { PushToggle } from "../../../lib/notifications/push-toggle";
import { useApiQuery } from "../../../lib/use-api-query";
import { usePagedQuery } from "../../../lib/use-paged-query";

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
  const list = usePagedQuery(notificationContract.listNotifications, {
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
        {list.status === "ready" && list.rows.length > 0 ? (
          <>
            <NotificationList
              notifications={list.rows}
              linkable
              onChanged={list.reload}
            />
            <ListFooter
              shown={list.rows.length}
              noun={list.rows.length === 1 ? "notification" : "notifications"}
              onMore={list.loadMore}
              loadingMore={list.loadingMore}
            />
            {list.moreError ? (
              <FormMessage tone="critical">{list.moreError}</FormMessage>
            ) : null}
          </>
        ) : (
          <ListFallback
            query={list}
            columns={1}
            empty={
              unreadOnly ? (
                <NoMatches
                  title="Nothing unread"
                  description="You have read every notification."
                  action={
                    <Button
                      tone="secondary"
                      onClick={() => setUnreadOnly(false)}
                    >
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
            }
          />
        )}
      </section>

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
