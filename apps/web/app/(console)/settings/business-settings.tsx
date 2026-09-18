"use client";

import { Lock } from "@phosphor-icons/react/dist/ssr";
import {
  type BusinessSetting,
  type SettingGroup,
  settingsContract,
} from "@repo/contracts";
import {
  Badge,
  Button,
  Card,
  DetailSkeleton,
  EmptyFrame,
  FormMessage,
  NotPermitted,
  PageHeader,
  Section,
} from "@repo/ui";
import { useState } from "react";

import { PageTrail } from "../../../components/page-trail";
import { LoadFailed } from "../../../components/query-state";
import { useApiQuery } from "../../../lib/use-api-query";
import { ChangeSettingDialog, ResetSettingDialog } from "./setting-dialogs";

/**
 * How each group reads on the screen. The badge is the promise the API keeps:
 * a `FORWARD_ONLY` change reaches nothing that already exists, and a `LOCKED`
 * one is refused by the API, not merely left without a button.
 */
const GROUP: Record<
  SettingGroup,
  { label: string; tone: "neutral" | "info" | "warning" }
> = {
  FREE: { label: "Applies at once", tone: "neutral" },
  FORWARD_ONLY: { label: "New records only", tone: "info" },
  LOCKED: { label: "Fixed", tone: "warning" },
};

const SECTIONS = [
  {
    id: "ORGANISATION" as const,
    title: "The business",
    description: "Who this Rasi belongs to, and the units it records in.",
  },
  {
    id: "ACCOUNTS" as const,
    title: "Accounts",
    description: "What a new account starts at, and when one counts as behind.",
  },
];

/**
 * S-28 · Business settings (US-094). Super Admin only — every other role is
 * refused at the API, which is what this screen shows them if they arrive here
 * by URL.
 *
 * The screen's job is to make the classification legible before anyone
 * changes anything: each setting says what happens when it moves, and a
 * setting that cannot move says why instead of hiding.
 */
export function BusinessSettingsScreen() {
  const settings = useApiQuery(settingsContract.getSettings, {});
  const [changing, setChanging] = useState<BusinessSetting | null>(null);
  const [resetting, setResetting] = useState<BusinessSetting | null>(null);

  const header = (
    <PageHeader
      trail={<PageTrail steps={[{ label: "Settings" }]} />}
      title="Business settings"
      description="The values the business runs on. Only a Super Admin sees or changes them, and every change is written to the audit log."
    />
  );

  if (settings.status !== "ready") {
    return (
      <>
        {header}
        {settings.status === "loading" ? <DetailSkeleton /> : null}
        {settings.status === "error" ? (
          <LoadFailed message={settings.message} onRetry={settings.reload} />
        ) : null}
        {settings.status === "not-found" ||
        settings.status === "not-permitted" ? (
          <EmptyFrame>
            <NotPermitted description="Business settings are the Super Admin's. Ask them if something here needs to change." />
          </EmptyFrame>
        ) : null}
      </>
    );
  }

  const { settings: rows, hasHistory } = settings.data;

  return (
    <>
      {header}

      <FormMessage tone="info">
        A setting marked <strong>New records only</strong> is read once, when a
        record is created, and copied onto it — existing accounts keep the
        values their schedules were generated from. A setting marked{" "}
        <strong>Fixed</strong> cannot be changed at all:{" "}
        {hasHistory
          ? "the business already has accounts, and every amount posted is in the units below."
          : "either it is settled in code, or it can still be corrected until the first account exists."}
      </FormMessage>

      {SECTIONS.map((section) => {
        const inSection = rows.filter((row) => row.section === section.id);
        if (inSection.length === 0) return null;
        return (
          <Section
            key={section.id}
            title={section.title}
            description={section.description}
          >
            <Card.Root>
              <ul className="flex flex-col divide-y divide-border">
                {inSection.map((row) => (
                  <li
                    key={row.key}
                    className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 p-4"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-label text-ink">{row.label}</h3>
                        <Badge tone={GROUP[row.group].tone}>
                          {GROUP[row.group].label}
                        </Badge>
                        {row.isOverridden ? (
                          <Badge tone="info">
                            Changed from {row.defaultValue}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-caption text-ink-muted">
                        {row.description}
                      </p>
                      <p className="text-caption text-ink-subtle">
                        {row.editable ? row.effect : row.lockedReason}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className="text-body font-medium text-ink tabular-nums"
                        data-numeric
                      >
                        {row.value}
                      </span>
                      {row.editable ? (
                        <>
                          <Button
                            tone="ghost"
                            size="sm"
                            onClick={() => setChanging(row)}
                          >
                            Change
                          </Button>
                          {row.isOverridden ? (
                            <Button
                              tone="ghost"
                              size="sm"
                              onClick={() => setResetting(row)}
                            >
                              Reset
                            </Button>
                          ) : null}
                        </>
                      ) : (
                        <span
                          className="flex items-center gap-1 text-caption text-ink-subtle"
                          title={row.lockedReason ?? undefined}
                        >
                          <Lock aria-hidden size={14} />
                          Fixed
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card.Root>
          </Section>
        );
      })}

      {changing ? (
        <ChangeSettingDialog
          setting={changing}
          onClose={() => setChanging(null)}
          onChanged={() => {
            setChanging(null);
            settings.reload();
          }}
        />
      ) : null}
      {resetting ? (
        <ResetSettingDialog
          setting={resetting}
          onClose={() => setResetting(null)}
          onReset={() => {
            setResetting(null);
            settings.reload();
          }}
        />
      ) : null}
    </>
  );
}
