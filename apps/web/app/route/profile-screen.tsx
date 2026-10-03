"use client";

import {
  ArrowsClockwise,
  Bell,
  CaretRight,
  Clock,
  CloudArrowDown,
  Key,
  SignOut,
  Translate,
  WifiHigh,
  WifiSlash,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import { type Me, notificationContract } from "@repo/contracts";
import { Badge, Button, cn } from "@repo/ui";
import { useState } from "react";

import { ChangePasswordDialog } from "../(console)/profile/change-password-dialog";
import { apiWrite } from "../../lib/api-write";
import { useApiQuery } from "../../lib/use-api-query";
import type { LocalRoute } from "../../lib/offline/outbox";
import { Banner, cardClass, FieldPage, Section } from "./app-chrome";
import { openView } from "./hash-view";
import { formatClockTime, initials } from "./sync-marks";

/**
 * J-08 · Profile (S-32 for the Junior). Who is signed in and on which line,
 * and the state of this phone: connection, what is still on it, when it last
 * sent and when the route was saved. Sign-out lives here, and is refused
 * while anything is unsent (US-002) — signing out clears the phone.
 */
export function ProfileScreen({
  me,
  local,
  connected,
  unsynced,
  lastSync,
  signOutBlocked,
  onSignOut,
}: {
  me: Me;
  local: LocalRoute | null;
  connected: boolean;
  unsynced: number;
  lastSync: string | null;
  signOutBlocked: boolean;
  onSignOut: () => void;
}) {
  const [changing, setChanging] = useState(false);
  const [changed, setChanged] = useState(false);
  const lines = local?.route.lines ?? [];

  return (
    <FieldPage title="Profile" testId="profile">
      <div className={cn(cardClass, "flex flex-col gap-3 p-4")}>
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="flex size-16 shrink-0 items-center justify-center rounded-pill bg-accent-subtle text-xl font-semibold text-accent"
          >
            {initials(me.name)}
          </span>
          <div className="flex min-w-0 flex-col">
            <h2 className="truncate text-lg font-semibold text-ink">
              {me.name}
            </h2>
            <p className="text-sm text-ink-muted">Junior collector</p>
            <p className="truncate font-mono text-xs text-ink-muted">
              {me.email}
            </p>
          </div>
        </div>
        {lines.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Your lines">
            {lines.map((line) => (
              <li
                key={line.lineId}
                className="flex w-fit items-center gap-1.5 rounded-pill bg-accent-subtle px-3 py-1 text-sm font-medium text-accent"
              >
                <span className="font-mono">{line.code}</span> · {line.name}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-ink-muted">{me.organization.name}</p>
      </div>

      <Section title="This phone">
        <ul className={cn(cardClass, "flex flex-col divide-y divide-border")}>
          <Tile
            icon={connected ? <WifiHigh size={22} /> : <WifiSlash size={22} />}
            label="Connection"
            value={
              <Badge tone={connected ? "positive" : "warning"} shape="pill">
                {connected ? "Online" : "Offline"}
              </Badge>
            }
          />
          <Tile
            icon={<ArrowsClockwise size={22} />}
            label="Not sent"
            value={
              unsynced > 0 ? (
                <Badge tone="warning" shape="pill">
                  {unsynced}
                </Badge>
              ) : (
                "None"
              )
            }
            onClick={() => openView("#sync")}
          />
          <Tile
            icon={<Clock size={22} />}
            label="Last sent"
            value={lastSync ? formatClockTime(lastSync) : "Not yet"}
          />
          <Tile
            icon={<CloudArrowDown size={22} />}
            label="Route saved"
            value={local ? formatClockTime(local.fetchedAt) : "Not yet"}
          />
          <Tile
            icon={<Bell size={22} />}
            label="Notifications"
            value="Alerts on this phone"
            onClick={() => openView("#notifications")}
          />
        </ul>
      </Section>

      <Section title="Account">
        <ul className={cn(cardClass, "flex flex-col divide-y divide-border")}>
          <Tile
            icon={<Key size={22} />}
            label="Change password"
            value={connected ? null : "Needs signal"}
            onClick={connected ? () => setChanging(true) : undefined}
          />
          <LanguageTile connected={connected} />
        </ul>
        {changed ? (
          <p role="status" className="px-1 text-sm text-positive">
            Password changed. Every other device is signed out.
          </p>
        ) : null}
      </Section>

      <Button
        tone="secondary"
        onClick={onSignOut}
        className="mt-2 h-12 w-full rounded-pill border-critical-border text-critical shadow-none hover:bg-critical-subtle hover:text-critical"
      >
        <SignOut aria-hidden size={20} weight="regular" />
        Sign out
      </Button>
      {signOutBlocked ? (
        <Banner
          tone="critical"
          icon={<Warning size={20} weight="regular" />}
          action={
            <Button
              tone="ghost"
              onClick={() => openView("#sync")}
              className="rounded-pill font-semibold text-critical hover:text-critical"
            >
              Open Sync
            </Button>
          }
        >
          {unsynced} {unsynced === 1 ? "collection is" : "collections are"}{" "}
          still on this phone. Send them before signing out.
        </Banner>
      ) : null}

      {changing ? (
        <ChangePasswordDialog
          onClose={() => setChanging(false)}
          onChanged={() => {
            setChanging(false);
            setChanged(true);
          }}
        />
      ) : null}
    </FieldPage>
  );
}

/**
 * US-074: what this Junior's notifications are written in. Read and saved
 * only with signal — like the password, it lives on the server, not the phone.
 */
function LanguageTile({ connected }: { connected: boolean }) {
  const preferences = useApiQuery(
    notificationContract.getPreferences,
    connected ? {} : null,
  );
  const [saving, setSaving] = useState(false);

  async function choose(language: "EN" | "TA") {
    setSaving(true);
    await apiWrite(notificationContract.updatePreferences, {
      body: { language },
    });
    setSaving(false);
    preferences.reload();
  }

  return (
    <Tile
      icon={<Translate size={22} />}
      label="Notification language"
      value={
        connected && preferences.status === "ready" ? (
          <select
            aria-label="Notification language"
            value={preferences.data.language}
            disabled={saving}
            onChange={(event) => void choose(event.target.value as "EN" | "TA")}
            className="rounded-control border border-border bg-surface px-2 py-1 text-sm text-ink"
          >
            <option value="EN">English</option>
            <option value="TA">தமிழ்</option>
          </select>
        ) : connected ? null : (
          "Needs signal"
        )
      }
    />
  );
}

function Tile({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span aria-hidden className="shrink-0 text-ink-muted">
        {icon}
      </span>
      <span className="flex-1 text-base text-ink">{label}</span>
      {value !== null ? (
        <span className="shrink-0 text-sm text-ink-muted" data-numeric>
          {value}
        </span>
      ) : null}
      {onClick ? (
        <CaretRight
          aria-hidden
          size={18}
          weight="regular"
          className="shrink-0 text-ink-subtle"
        />
      ) : null}
    </>
  );
  return (
    <li>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left active:bg-surface-sunken"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-h-14 items-center gap-3 px-4 py-2">{body}</div>
      )}
    </li>
  );
}
