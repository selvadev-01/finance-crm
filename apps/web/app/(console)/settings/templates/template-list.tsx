"use client";

import {
  notificationTemplateContract,
  type TemplateGroup,
  type TemplateSummary,
} from "@repo/contracts";
import {
  Badge,
  DataView,
  DetailSkeleton,
  EmptyFrame,
  FormMessage,
  NotPermitted,
  PageHeader,
  Section,
} from "@repo/ui";

import {
  displayColumn,
  identityColumn,
  valueColumn,
} from "../../../../components/columns";
import { LoadFailed } from "../../../../components/query-state";
import {
  CATEGORY_LABEL,
  CATEGORY_TONE,
} from "../../../../lib/notifications/notification-list";
import { useApiQuery } from "../../../../lib/use-api-query";
import { LANGUAGE_LABEL } from "./languages";

const GROUPS: { id: TemplateGroup; title: string; description: string }[] = [
  {
    id: "COLLECTIONS",
    title: "Collections",
    description: "What a Senior hears about the round, as it happens.",
  },
  {
    id: "ACCOUNTS",
    title: "Customers and accounts",
    description: "New customers, new accounts and accounts that finish or fall behind.",
  },
  {
    id: "CASH",
    title: "Cash and expenses",
    description: "Handovers, cash differences and field expenses.",
  },
  {
    id: "ORGANISATION",
    title: "Lines and holidays",
    description: "Assignments and changes to the working calendar.",
  },
  {
    id: "SYSTEM",
    title: "System",
    description: "What the nightly jobs found, for the Admins.",
  },
  {
    id: "SIGN_IN",
    title: "Sign-in",
    description: "Email a staff member asks for themselves.",
  },
];

/**
 * US-074 · the list of every message, one `DataView` per area — a table on a
 * computer, cards on a phone. Each row says who receives it, how it reaches
 * them and whose words it uses; the whole row opens its editor.
 */
export function TemplateList() {
  const templates = useApiQuery(notificationTemplateContract.listTemplates, {});

  const header = (
    <PageHeader
      title="Message templates"
      description="The words of every notification and email Rasi sends your staff, in English and Tamil. Change them here; every change is written to the audit log."
    />
  );

  if (templates.status !== "ready") {
    return (
      <>
        {header}
        {templates.status === "loading" ? <DetailSkeleton /> : null}
        {templates.status === "error" ? (
          <LoadFailed message={templates.message} onRetry={templates.reload} />
        ) : null}
        {templates.status === "not-found" ||
        templates.status === "not-permitted" ? (
          <EmptyFrame>
            <NotPermitted description="Message templates are the Super Admin's. Ask them if a message should read differently." />
          </EmptyFrame>
        ) : null}
      </>
    );
  }

  const { templates: rows, delivery } = templates.data;

  return (
    <>
      {header}

      {!delivery.push || !delivery.email ? (
        <FormMessage tone="info">
          {!delivery.push && !delivery.email
            ? "Push and email are not set up on this server yet, so messages reach the bell in the app only."
            : !delivery.email
              ? "Email is not set up on this server yet, so nothing is emailed until it is. The switches below take effect then."
              : "Push is not set up on this server yet, so nothing buzzes a phone until it is."}
        </FormMessage>
      ) : null}

      {GROUPS.map((group) => {
        const inGroup = rows.filter((row) => row.group === group.id);
        if (inGroup.length === 0) return null;
        return (
          <Section
            key={group.id}
            title={group.title}
            description={group.description}
          >
            <DataView
              caption={`${group.title} messages`}
              rows={inGroup}
              getRowId={(row) => row.key}
              complete
              columns={COLUMNS}
            />
          </Section>
        );
      })}
    </>
  );
}

/** One message per row; the name opens its editor (US-074). */
const COLUMNS = [
  identityColumn<TemplateSummary>({
    header: "Message",
    name: (row) => row.label,
    code: (row) => row.description,
    href: (row) => `/settings/templates/${row.key}`,
  }),
  displayColumn<TemplateSummary>({
    id: "category",
    header: "Kind",
    card: "status",
    cell: (row) =>
      row.category ? (
        <Badge tone={CATEGORY_TONE[row.category]}>
          {CATEGORY_LABEL[row.category]}
        </Badge>
      ) : (
        <Badge>Email only</Badge>
      ),
  }),
  valueColumn<TemplateSummary>({
    id: "recipients",
    header: "Sent to",
    value: (row) => row.recipients,
  }),
  valueColumn<TemplateSummary>({
    id: "channels",
    header: "Reaches them",
    value: channelsText,
  }),
  displayColumn<TemplateSummary>({
    id: "words",
    header: "Words",
    cell: (row) =>
      row.overridden.length === 0 ? (
        <span className="text-ink-muted">Rasi’s</span>
      ) : (
        <span className="inline-flex flex-wrap gap-1">
          {row.overridden.map((language) => (
            <Badge key={language} tone="info" mark="none">
              Yours · {LANGUAGE_LABEL[language]}
            </Badge>
          ))}
        </span>
      ),
  }),
];

/** "In the app, pushed and emailed" — how it reaches people, in words. */
function channelsText(row: TemplateSummary): string {
  const ways = [
    row.channels.inApp ? "in the app" : null,
    row.channels.push?.enabled ? "pushed" : null,
    row.channels.email.enabled ? "emailed" : null,
  ].filter((way): way is string => way !== null);
  const text =
    ways.length > 1
      ? `${ways.slice(0, -1).join(", ")} and ${ways.at(-1)}`
      : (ways[0] ?? "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
