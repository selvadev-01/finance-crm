"use client";

import {
  type NotificationCategory,
  notificationContract,
  type NotificationView,
} from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  Badge,
  type BadgeProps,
  Button,
  cn,
  formatBusinessDate,
  FormMessage,
} from "@repo/ui";
import Link from "next/link";
import { useState } from "react";

import { apiWrite } from "../api-write";
import { formatTimestamp } from "../format";
import { announceUnreadChanged } from "./use-unread-count";

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  ALERT: "Alert",
  WARNING: "Warning",
  SUCCESS: "Success",
  INFORMATION: "Information",
};

const CATEGORY_TONE: Record<
  NotificationCategory,
  NonNullable<BadgeProps["tone"]>
> = {
  ALERT: "critical",
  WARNING: "warning",
  SUCCESS: "positive",
  INFORMATION: "info",
};

/** Newest first, grouped by business day (navigation-ia.md#notifications). */
function byDay(notifications: NotificationView[]) {
  const days: { date: string; items: NotificationView[] }[] = [];
  for (const notification of notifications) {
    const date = toBusinessDate(new Date(notification.createdAt));
    const last = days.at(-1);
    if (last?.date === date) last.items.push(notification);
    else days.push({ date, items: [notification] });
  }
  return days;
}

/**
 * The notification centre's list (US-070), grouped by day, shared by the console and the
 * Junior's field app. Unread rows are marked by weight and a dot, not colour
 * alone. `linkable` is false for the Junior, whose deep links point at console
 * pages they cannot open — tapping marks it read instead.
 */
export function NotificationList({
  notifications,
  linkable,
  onChanged,
}: {
  notifications: NotificationView[];
  linkable: boolean;
  onChanged: () => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);

  async function markRead(notification: NotificationView) {
    if (notification.readAt) return;
    const result = await apiWrite(notificationContract.markRead, {
      params: { notificationId: notification.id },
      body: {},
    });
    setFailed(
      result.ok ? null : (result.form ?? "Could not mark it read. Try again."),
    );
    announceUnreadChanged();
    onChanged();
  }

  return (
    <>
      {failed ? <FormMessage tone="critical">{failed}</FormMessage> : null}
      <div className="flex flex-col gap-4" data-testid="notification-list">
        {byDay(notifications).map((day) => (
          <section
            key={day.date}
            className="flex flex-col gap-2"
            aria-label={formatBusinessDate(day.date)}
          >
            <h3 className="text-2xs font-medium tracking-wider text-ink-subtle uppercase">
              {formatBusinessDate(day.date)}
            </h3>
            <ul className="flex flex-col gap-2">
              {day.items.map((notification) => {
                const unread = notification.readAt === null;
                const content = (
                  <>
                    <span className="flex flex-wrap items-center gap-2">
                      {unread ? (
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-full bg-accent"
                        />
                      ) : null}
                      <Badge tone={CATEGORY_TONE[notification.category]}>
                        {CATEGORY_LABEL[notification.category]}
                      </Badge>
                      <span
                        className={cn(
                          "text-body text-ink",
                          unread ? "font-semibold" : "font-medium",
                        )}
                      >
                        {notification.title}
                      </span>
                      {unread ? (
                        <span className="sr-only">(unread)</span>
                      ) : null}
                    </span>
                    <span className="text-body text-ink-muted">
                      {notification.body}
                    </span>
                    <span className="text-caption text-ink-muted tabular-nums">
                      {formatTimestamp(notification.createdAt, "short")}
                    </span>
                  </>
                );
                const rowClass = cn(
                  "flex w-full flex-col items-start gap-1 rounded-surface border px-4 py-3 text-left transition-colors",
                  unread
                    ? "border-border-strong bg-surface-raised shadow-raised"
                    : "border-border bg-surface",
                );
                return (
                  <li key={notification.id} className="flex flex-col gap-1">
                    {linkable && notification.link ? (
                      <Link
                        href={notification.link.url}
                        className={cn(rowClass, "hover:bg-surface-sunken/70")}
                        onClick={() => void markRead(notification)}
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className={rowClass}>
                        {content}
                        {unread ? (
                          <Button
                            tone="ghost"
                            className="-ml-2.5 mt-1"
                            onClick={() => void markRead(notification)}
                          >
                            Mark read
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

export async function markAllRead(): Promise<boolean> {
  const result = await apiWrite(notificationContract.markAllRead, { body: {} });
  announceUnreadChanged();
  return result.ok;
}
