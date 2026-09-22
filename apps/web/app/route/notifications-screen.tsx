"use client";

import { Bell, CloudSlash } from "@phosphor-icons/react/dist/ssr";
import { notificationContract, type NotificationView } from "@repo/contracts";
import { Button, cn, FormMessage } from "@repo/ui";
import { useCallback, useEffect, useState } from "react";

import { api } from "../../lib/api-client";
import {
  markAllRead,
  NotificationList,
} from "../../lib/notifications/notification-list";
import { PushToggle } from "../../lib/notifications/push-toggle";
import { SW_SCOPE, SW_URL } from "../../lib/offline/client";
import { Banner, cardClass, FieldPage } from "./app-chrome";

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
    <FieldPage
      back
      title="Notifications"
      subtitle={unread > 0 ? `${unread} unread` : undefined}
      actions={
        unread > 0 ? (
          <Button
            tone="ghost"
            onClick={async () => {
              await markAllRead();
              await load();
            }}
            className="rounded-pill font-semibold text-accent"
          >
            Mark all read
          </Button>
        ) : (
          false
        )
      }
      testId="notifications"
    >
      {!connected ? (
        <Banner tone="neutral" icon={<CloudSlash size={20} weight="regular" />}>
          Connect to see notifications. Your collections still save on this
          phone.
        </Banner>
      ) : null}
      {problem && connected ? (
        <FormMessage tone="critical">{problem}</FormMessage>
      ) : null}

      {connected ? (
        <div className={cn(cardClass, "p-4")}>
          <PushToggle worker={FIELD_WORKER} deviceLabel="Field phone" />
        </div>
      ) : null}

      {notifications?.length === 0 ? (
        <div
          className={cn(
            cardClass,
            "flex flex-col items-center gap-3 px-6 py-10 text-center",
          )}
        >
          <span
            aria-hidden
            className="flex size-16 items-center justify-center rounded-pill bg-accent-subtle text-accent"
          >
            <Bell size={28} weight="regular" />
          </span>
          <p className="text-base text-ink-muted">No notifications yet.</p>
        </div>
      ) : null}
      {notifications && notifications.length > 0 ? (
        <div className={cn(cardClass, "overflow-hidden")}>
          <NotificationList
            notifications={notifications}
            linkable={false}
            onChanged={() => void load()}
          />
        </div>
      ) : null}
    </FieldPage>
  );
}
