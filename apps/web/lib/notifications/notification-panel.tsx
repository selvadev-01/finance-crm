"use client";

import { notificationContract } from "@repo/contracts";
import {
  Button,
  FormMessage,
  ListFooter,
  NoMatches,
  NothingYet,
} from "@repo/ui";
import Link from "next/link";
import { useState } from "react";

import { ListFallback } from "../../components/list-state";
import { useInfiniteQuery } from "../use-infinite-query";
import { markAllRead, NotificationList } from "./notification-list";

/** One panel-ful. Older notifications arrive through "Show more". */
const PAGE = 20;

/**
 * S-21, the notification centre, as the panel the console's bell opens
 * (US-070) — a popover on a computer, a sheet on a phone. There is no
 * `/notifications` page: the bell is the whole surface, because a notification
 * is read on the way to its subject and a page in between is a stop for
 * nothing (decided 2026-09-21).
 *
 * The preferences that used to sit under this list are a Settings tab,
 * `/settings/notifications` (US-071, US-073).
 */
export function NotificationPanel({ onNavigate }: { onNavigate: () => void }) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useInfiniteQuery(notificationContract.listNotifications, {
    query: { limit: PAGE, ...(unreadOnly ? { unread: "true" as const } : {}) },
  });
  const unread = list.status === "ready" ? list.data.unreadCount : 0;

  return (
    <div className="flex min-w-0 flex-col gap-[var(--stack-gap)]">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-caption text-ink-muted" role="status">
          {list.status === "ready"
            ? `${unread} unread`
            : "What needs your attention."}
        </p>
        <div className="flex items-center gap-1">
          <Button
            tone="ghost"
            size="sm"
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly((value) => !value)}
          >
            {unreadOnly ? "Show all" : "Unread only"}
          </Button>
          <Button
            tone="ghost"
            size="sm"
            disabled={unread === 0}
            onClick={async () => {
              await markAllRead();
              list.reload();
            }}
          >
            Mark all read
          </Button>
        </div>
      </div>

      {/* The panel scrolls, not the page behind it. */}
      <div className="-mx-1 max-h-[min(28rem,60dvh)] overflow-y-auto px-1 py-0.5">
        {list.status === "ready" && list.rows.length > 0 ? (
          <div className="flex flex-col gap-[var(--stack-gap)]">
            <NotificationList
              notifications={list.rows}
              linkable
              onChanged={list.reload}
              onFollowLink={onNavigate}
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
          </div>
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
      </div>

      <Link
        href="/settings/notifications"
        onClick={onNavigate}
        className="text-caption text-ink-muted underline-offset-4 hover:text-ink hover:underline"
      >
        Choose what to be notified about
      </Link>
    </div>
  );
}
