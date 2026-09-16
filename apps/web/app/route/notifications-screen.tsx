"use client";

import { CaretLeft, CloudSlash } from "@phosphor-icons/react/dist/ssr";
import { notificationContract, type NotificationView } from "@repo/contracts";
import { Button, FormMessage } from "@repo/ui";
import { useCallback, useEffect, useState } from "react";

import { api } from "../../lib/api-client";
import {
  markAllRead,
  NotificationList,
} from "../../lib/notifications/notification-list";
import { PushToggle } from "../../lib/notifications/push-toggle";
import { SW_SCOPE, SW_URL } from "../../lib/offline/client";
import { backToRoute } from "./hash-view";

const FIELD_WORKER = { url: SW_URL, scope: SW_SCOPE } as const;

/**
 * S-21 on the Junior's phone (US-070): their notifications, newest first,
 * grouped by day. Needs signal — notifications are not kept on the phone, so
 * nothing here competes with the outbox for storage. Push is switched on from
 * here, through the field app's own worker (US-071).
 */
export function NotificationsScreen({ connected }: { connected: boolean }) {
  const [notifications, setNotifications] = useState<NotificationView[] | null>(
    null,
  );
  const [unread, setUnread] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api(notificationContract.listNotifications, {
        query: { limit: 50 },
      });
      if (!result.ok) {
        setProblem("Could not load notifications. Try again.");
        return;
      }
      setNotifications(result.body.data);
      setUnread(result.body.unreadCount);
      setProblem(null);
    } catch {
      setProblem("No signal. Connect to see notifications.");
    }
  }, []);

  useEffect(() => {
    // Loading the list is the external read this effect synchronises with.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, connected]);

  return (
    <div
      className="flex flex-col gap-[var(--stack-gap)]"
      data-testid="notifications"
    >
      <div>
        <Button tone="ghost" onClick={backToRoute} className="-ml-3">
          <CaretLeft aria-hidden size={20} weight="regular" />
          Route
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-ink">Notifications</h1>
        {unread > 0 ? (
          <Button
            tone="secondary"
            onClick={async () => {
              await markAllRead();
              await load();
            }}
          >
            Mark all read
          </Button>
        ) : null}
      </div>

      {!connected ? (
        <FormMessage tone="info">
          <span className="flex items-center gap-2">
            <CloudSlash aria-hidden size={18} weight="regular" />
            Connect to see notifications. Your collections still save on this
            phone.
          </span>
        </FormMessage>
      ) : null}
      {problem && connected ? (
        <FormMessage tone="critical">{problem}</FormMessage>
      ) : null}

      {notifications?.length === 0 ? (
        <p className="text-sm text-ink-muted">No notifications yet.</p>
      ) : null}
      {notifications && notifications.length > 0 ? (
        <NotificationList
          notifications={notifications}
          linkable={false}
          onChanged={() => void load()}
        />
      ) : null}

      {connected ? (
        <PushToggle worker={FIELD_WORKER} deviceLabel="Field phone" />
      ) : null}
    </div>
  );
}
