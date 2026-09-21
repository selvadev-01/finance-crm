"use client";

import {
  Desktop,
  DeviceMobile,
  DownloadSimple,
} from "@phosphor-icons/react/dist/ssr";
import { staffContract } from "@repo/contracts";
import {
  Badge,
  Button,
  Card,
  Description,
  DescriptionList,
  formatBusinessDate,
  PageHeader,
  Section,
  toast,
} from "@repo/ui";
import Link from "next/link";
import { useState } from "react";

import { useSavedLayout } from "../../../lib/device-layout";
import { formatMobile } from "../../../lib/format";
import { useCanInstall } from "../../../lib/install-prompt";
import { ROLE_LABEL } from "../../../lib/roles";
import { useApiQuery } from "../../../lib/use-api-query";
import { useSignedIn } from "../../../lib/use-me";
import { LayoutDialog } from "../layout-chooser";
import { ChangePasswordDialog } from "./change-password-dialog";

/**
 * "My profile": who Rasi thinks the reader is, how they sign in, and what this
 * device is set to. It is theirs to read — changing a name, a role or an
 * assignment is staff administration and lives on the Team screens (US-092),
 * where the API's rank rules apply.
 *
 * Most of it comes from `/api/me`, which every console page already has. The
 * staff record adds the code, the mobile and the line worked today; a Senior
 * between assignments is out of their own scope there (`staffScope`) and is
 * simply shown less, rather than an error for a page about themselves.
 */
export function ProfileScreen() {
  const me = useSignedIn();
  const staff = useApiQuery(staffContract.getStaff, {
    params: { staffProfileId: me.staffProfileId },
  });
  const savedLayout = useSavedLayout();
  const canInstall = useCanInstall();
  const [dialog, setDialog] = useState<
    "password" | "switch" | "install" | null
  >(null);

  const record = staff.status === "ready" ? staff.data : null;
  const assignment = record?.currentAssignment ?? null;

  return (
    <>
      <PageHeader
        title={me.name}
        meta={
          <>
            <Badge tone="info">{ROLE_LABEL[me.role]}</Badge>
            {record ? <span data-numeric>{record.staffCode}</span> : null}
          </>
        }
        description={`Your details at ${me.organization.name}.`}
      />

      <Section title="Your details">
        <Card.Root>
          <Card.Body>
            <DescriptionList layout="rows">
              <Description term="Name">{me.name}</Description>
              <Description term="Email">{me.email}</Description>
              <Description term="Mobile">
                {record ? formatMobile(record.phone) : null}
              </Description>
              <Description term="Role">{ROLE_LABEL[me.role]}</Description>
              <Description term="Line today">
                {assignment ? (
                  <Link
                    href={`/lines/${assignment.lineId}`}
                    className="hover:text-accent hover:underline"
                  >
                    {assignment.lineCode} · {assignment.lineName}
                  </Link>
                ) : null}
              </Description>
              <Description term="Joined">
                {record ? formatBusinessDate(record.joinedAt) : null}
              </Description>
              <Description term="Business">{me.organization.name}</Description>
            </DescriptionList>
          </Card.Body>
        </Card.Root>
        <p className="text-caption text-ink-subtle">
          Your name, mobile, role and line are kept by an administrator. Ask
          them if something here is wrong.
        </p>
      </Section>

      <Section
        title="Signing in"
        description="Your password is the only thing here you change yourself."
      >
        <Card.Root>
          <Card.Body className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <p className="text-body text-ink-muted">
              Changing it signs out every other device you are signed in on.
            </p>
            <Button tone="secondary" onClick={() => setDialog("password")}>
              Change password
            </Button>
          </Card.Body>
        </Card.Root>
      </Section>

      <Section
        title="This device"
        description="Kept on this device only, not on your account (ADR-0016)."
      >
        <Card.Root>
          <Card.Body className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <p className="text-body text-ink-muted">
              {savedLayout === "mobile"
                ? "Rasi is showing the phone layout here: tabs at the bottom, one column."
                : "Rasi is showing the computer layout here: a sidebar and wide tables."}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button tone="secondary" onClick={() => setDialog("switch")}>
                {savedLayout === "mobile" ? (
                  <DeviceMobile aria-hidden size={18} />
                ) : (
                  <Desktop aria-hidden size={18} />
                )}
                Change layout
              </Button>
              {canInstall ? (
                <Button tone="secondary" onClick={() => setDialog("install")}>
                  <DownloadSimple aria-hidden size={18} />
                  Install Rasi
                </Button>
              ) : null}
            </div>
          </Card.Body>
        </Card.Root>
      </Section>

      {dialog === "password" ? (
        <ChangePasswordDialog
          onClose={() => setDialog(null)}
          onChanged={() => {
            setDialog(null);
            toast({ title: "Password changed" });
          }}
        />
      ) : null}
      {dialog === "switch" || dialog === "install" ? (
        <LayoutDialog
          purpose={dialog}
          current={savedLayout}
          placement={savedLayout === "mobile" ? "sheet" : "center"}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
