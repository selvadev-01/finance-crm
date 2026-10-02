"use client";

import {
  notificationTemplateContract as api,
  type TemplateContentInput,
  type TemplateDetail,
  type TemplateLanguage,
} from "@repo/contracts";
import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Choice,
  DetailSkeleton,
  Dialog,
  DialogActions,
  EmptyFrame,
  Field,
  FormMessage,
  Input,
  NotPermitted,
  NothingYet,
  PageHeader,
  Section,
  Switch,
  Tabs,
  Textarea,
  toast,
} from "@repo/ui";
import Link from "next/link";
import { useRef, useState } from "react";

import { LoadFailed } from "../../../../../components/query-state";
import { apiWrite } from "../../../../../lib/api-write";
import {
  CATEGORY_LABEL,
  CATEGORY_TONE,
} from "../../../../../lib/notifications/notification-list";
import { useApiQuery } from "../../../../../lib/use-api-query";
import { LANGUAGE_LABEL, LANGUAGES } from "../languages";
import { fieldIssues, TemplatePreview, usePreview } from "./template-preview";

type FieldName = keyof TemplateContentInput;

interface FieldSpec {
  name: FieldName;
  label: string;
  hint: string;
  rows?: number;
}

const IN_APP: FieldSpec[] = [
  { name: "title", label: "Title", hint: "One line, up to 120 characters." },
  {
    name: "body",
    label: "Text",
    hint: "Up to 500 characters. A phone shows the first two lines.",
    rows: 3,
  },
];

const EMAIL: FieldSpec[] = [
  { name: "emailSubject", label: "Subject", hint: "One line, up to 150 characters." },
  { name: "emailHeading", label: "Heading", hint: "The first line of the email." },
  {
    name: "emailBody",
    label: "Message",
    hint: "Leave a blank line between paragraphs.",
    rows: 6,
  },
  {
    name: "emailAction",
    label: "Button",
    hint: "Up to 40 characters. The button always opens the subject in Rasi.",
  },
  { name: "emailFooter", label: "Footer", hint: "Why they are getting this email.", rows: 2 },
];

/**
 * US-074 · one message. The screen's promise is that what the Super Admin
 * sees is what the staff will read: the preview is rendered by the API from
 * the unsaved words, through the same code that sends them, with sample
 * values — and a placeholder the message cannot fill is marked at its field
 * before anything is saved.
 */
export function TemplateEditor({ templateKey }: { templateKey: string }) {
  const detail = useApiQuery(api.getTemplate, { params: { key: templateKey } });

  const trail = (label: string) => (
    <Breadcrumbs>
      <Link href="/settings/templates">Message templates</Link>
      <span>{label}</span>
    </Breadcrumbs>
  );

  if (detail.status !== "ready") {
    return (
      <>
        <PageHeader title="Message template" trail={trail("Message")} />
        {detail.status === "loading" ? <DetailSkeleton /> : null}
        {detail.status === "error" ? (
          <LoadFailed message={detail.message} onRetry={detail.reload} />
        ) : null}
        {detail.status === "not-found" ? (
          <EmptyFrame>
            <NothingYet
              title="No such message"
              description="This link does not name a message Rasi sends."
            />
          </EmptyFrame>
        ) : null}
        {detail.status === "not-permitted" ? (
          <EmptyFrame>
            <NotPermitted description="Message templates are the Super Admin's. Ask them if a message should read differently." />
          </EmptyFrame>
        ) : null}
      </>
    );
  }

  const data = detail.data;
  return (
    <>
      <PageHeader
        title={data.label}
        trail={trail(data.label)}
        meta={
          data.category ? (
            <Badge tone={CATEGORY_TONE[data.category]}>
              {CATEGORY_LABEL[data.category]}
            </Badge>
          ) : (
            <Badge>Email only</Badge>
          )
        }
        description={`${data.description} Sent to: ${data.recipients}.`}
      />
      <Channels detail={data} onChanged={detail.reload} />
      {/* Remounted on every reload, so drafts start from what was saved. */}
      <Editor
        key={JSON.stringify(data.versions)}
        detail={data}
        onSaved={detail.reload}
      />
    </>
  );
}

function Channels({
  detail,
  onChanged,
}: {
  detail: TemplateDetail;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { push, email } = detail.channels;

  async function change(channel: "push" | "email", enabled: boolean) {
    setSaving(true);
    const result = await apiWrite(api.updateChannels, {
      params: { key: detail.key },
      body: { [channel]: enabled },
    });
    setSaving(false);
    setProblem(result.ok ? null : (result.form ?? "Could not save. Try again."));
    if (result.ok) {
      toast({
        title: `${detail.label} ${enabled ? "will be" : "will not be"} ${channel === "push" ? "pushed" : "emailed"}`,
        description: "From the next one sent. Messages already sent are unchanged.",
      });
      onChanged();
    }
  }

  const describe = (
    channel: NonNullable<typeof push>,
    on: string,
    off: string,
  ) =>
    channel.lockedReason ??
    `${channel.enabled ? on : off}${channel.enabled === channel.defaultEnabled ? " — Rasi’s default." : ""}`;

  return (
    <Section
      title="How it reaches people"
      description={
        detail.channels.inApp
          ? "It always appears under the bell in the app — that is the record. These choose what else happens."
          : "Sent by email only."
      }
    >
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <Card.Root>
        <ul className="flex flex-col divide-y divide-border">
          {push ? (
            <li className="px-4 py-3">
              <Choice
                label="Push to their phones and browsers"
                description={describe(
                  push,
                  "Buzzes every device they have switched on.",
                  "Not pushed; they see it when they open the app.",
                )}
              >
                <Switch
                  checked={push.enabled}
                  disabled={push.lockedReason !== null || saving}
                  onCheckedChange={(on) => void change("push", on)}
                />
              </Choice>
            </li>
          ) : null}
          <li className="px-4 py-3">
            <Choice
              label="Email them"
              description={describe(
                email,
                "A copy goes to their email address.",
                "Not emailed.",
              )}
            >
              <Switch
                checked={email.enabled}
                disabled={email.lockedReason !== null || saving}
                onCheckedChange={(on) => void change("email", on)}
              />
            </Choice>
          </li>
        </ul>
      </Card.Root>
    </Section>
  );
}

function Editor({
  detail,
  onSaved,
}: {
  detail: TemplateDetail;
  onSaved: () => void;
}) {
  const [language, setLanguage] = useState<TemplateLanguage>("EN");
  const [drafts, setDrafts] = useState(
    () =>
      Object.fromEntries(
        detail.versions.map((version) => [version.language, version.content]),
      ) as Record<TemplateLanguage, TemplateContentInput>,
  );
  const [saveErrors, setSaveErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState<"save" | "test" | null>(null);
  const [resetting, setResetting] = useState(false);
  const fields = useRef(new Map<FieldName, HTMLInputElement | HTMLTextAreaElement>());
  const lastField = useRef<FieldName | null>(null);

  const version = detail.versions.find((v) => v.language === language)!;
  const draft = drafts[language];
  const dirty = (lang: TemplateLanguage) =>
    !sameContent(drafts[lang], detail.versions.find((v) => v.language === lang)!.content);
  const preview = usePreview(detail.key, language, draft);
  const errors = { ...preview.problems, ...saveErrors };
  const hasPush = draft.title !== null;

  function edit(name: FieldName, value: string) {
    setDrafts((all) => ({ ...all, [language]: { ...all[language], [name]: value } }));
    setSaveErrors((all) => ({ ...all, [name]: undefined }));
    setProblem(null);
  }

  /** Puts `{{name}}` where the cursor was in the field last used. */
  function insert(placeholder: string, emailOnly: boolean) {
    const name =
      lastField.current && !(emailOnly && isInApp(lastField.current))
        ? lastField.current
        : emailOnly || !hasPush
          ? "emailBody"
          : "body";
    const element = fields.current.get(name);
    const current = draft[name] ?? "";
    const token = `{{${placeholder}}}`;
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? current.length;
    edit(name, current.slice(0, start) + token + current.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save() {
    setPending("save");
    setProblem(null);
    const result = await apiWrite(api.saveTemplate, {
      params: { key: detail.key, language },
      body: draft,
    });
    setPending(null);
    if (!result.ok) {
      setSaveErrors(fieldIssues(result.details));
      return setProblem(
        result.code === "TEMPLATE_UNCHANGED"
          ? "These are already the words in use."
          : (result.form ?? "The template was not saved."),
      );
    }
    toast({
      title: `${detail.label} saved in ${LANGUAGE_LABEL[language]}`,
      description: "The next one sent uses these words. Messages already sent are unchanged.",
    });
    onSaved();
  }

  async function sendTest() {
    setPending("test");
    const result = await apiWrite(api.sendTestTemplate, {
      params: { key: detail.key },
      body: { language },
    });
    setPending(null);
    if (!result.ok) {
      return setProblem(result.form ?? "The test was not sent.");
    }
    const { inApp, pushDevices, emailQueued } = result.body;
    const reached = [
      inApp ? "your bell" : null,
      pushDevices > 0 ? `${pushDevices} ${pushDevices === 1 ? "device" : "devices"}` : null,
      emailQueued ? "your inbox" : null,
    ].filter(Boolean);
    toast({
      title: "Test sent to you",
      description: `${reached.join(", ") || "Nowhere — push and email are not set up"}. It uses the saved words${dirty(language) ? ", not your unsaved changes" : ""}, with sample values. Push and email can take a minute.`,
    });
  }

  return (
    <Tabs.Root
      value={language}
      onValueChange={(value) => setLanguage(value as TemplateLanguage)}
    >
      <Tabs.List aria-label="Language">
        {LANGUAGES.map((lang) => {
          const v = detail.versions.find((x) => x.language === lang)!;
          return (
            <Tabs.Trigger key={lang} value={lang}>
              {LANGUAGE_LABEL[lang]}
              {v.isOverridden ? (
                <Badge tone="info" mark="none">
                  Your words
                </Badge>
              ) : null}
              {dirty(lang) ? (
                <Badge tone="warning" mark="none">
                  Unsaved
                </Badge>
              ) : null}
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>

      {LANGUAGES.map((lang) => (
        <Tabs.Content key={lang} value={lang}>
          {lang !== language ? null : (
            <div className="grid gap-[var(--section-gap)] xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
              <div className="flex min-w-0 flex-col gap-[var(--section-gap)]">
                <FormMessage tone="info">
                  {version.isOverridden
                    ? `These are your own words, saved ${new Date(version.updatedAt!).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.`
                    : "These are Rasi’s own words. Change any of them and save to use yours instead."}
                </FormMessage>

                <Placeholders detail={detail} onInsert={insert} />

                {hasPush ? (
                  <Section
                    as="h3"
                    title="In the app and on the phone"
                    description="Under the bell, and the push notification."
                  >
                    {IN_APP.map((spec) => (
                      <TemplateField
                        key={spec.name}
                        spec={spec}
                        value={draft[spec.name] ?? ""}
                        error={errors[spec.name]}
                        register={(el) => register(fields.current, spec.name, el)}
                        onFocus={() => (lastField.current = spec.name)}
                        onChange={(value) => edit(spec.name, value)}
                      />
                    ))}
                  </Section>
                ) : null}

                <Section
                  as="h3"
                  title="Email"
                  description={
                    hasPush
                      ? "{{title}} and {{body}} are the words above, so the email follows them unless you write it separately."
                      : undefined
                  }
                >
                  {EMAIL.map((spec) => (
                    <TemplateField
                      key={spec.name}
                      spec={spec}
                      value={draft[spec.name] ?? ""}
                      error={errors[spec.name]}
                      register={(el) => register(fields.current, spec.name, el)}
                      onFocus={() => (lastField.current = spec.name)}
                      onChange={(value) => edit(spec.name, value)}
                    />
                  ))}
                </Section>

                {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    tone="primary"
                    disabled={!dirty(language) || pending !== null}
                    onClick={() => void save()}
                  >
                    {pending === "save" ? "Saving…" : `Save ${LANGUAGE_LABEL[language]}`}
                  </Button>
                  <Button
                    tone="ghost"
                    disabled={!dirty(language) || pending !== null}
                    onClick={() => {
                      setDrafts((all) => ({ ...all, [language]: version.content }));
                      setSaveErrors({});
                      setProblem(null);
                    }}
                  >
                    Discard changes
                  </Button>
                  <span className="flex-1" />
                  <Button
                    tone="secondary"
                    disabled={pending !== null}
                    onClick={() => void sendTest()}
                  >
                    {pending === "test" ? "Sending…" : "Send a test to me"}
                  </Button>
                  {version.isOverridden ? (
                    <Button
                      tone="ghost"
                      disabled={pending !== null}
                      onClick={() => setResetting(true)}
                    >
                      Use Rasi’s words
                    </Button>
                  ) : null}
                </div>
              </div>

              <TemplatePreview preview={preview} category={detail.category} />
            </div>
          )}
        </Tabs.Content>
      ))}

      {resetting ? (
        <ResetDialog
          detail={detail}
          language={language}
          onClose={() => setResetting(false)}
          onReset={() => {
            setResetting(false);
            onSaved();
          }}
        />
      ) : null}
    </Tabs.Root>
  );
}

function Placeholders({
  detail,
  onInsert,
}: {
  detail: TemplateDetail;
  onInsert: (name: string, emailOnly: boolean) => void;
}) {
  const own = detail.variables.filter((v) => !v.emailOnly);
  const emailOnly = detail.variables.filter((v) => v.emailOnly);
  return (
    <Card.Root>
      <Card.Body className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-label text-ink">Placeholders</h3>
          <p className="text-caption text-ink-muted">
            Press one to put it where your cursor is. Rasi fills it in for each person.{" "}
            <code className="font-mono">{"{{#name}}…{{/name}}"}</code> shows words only when{" "}
            <code className="font-mono">name</code> has a value;{" "}
            <code className="font-mono">{"{{^name}}…{{/name}}"}</code> only when it has none.
          </p>
        </div>
        <ul className="flex flex-wrap gap-2">
          {[...own, ...emailOnly].map((variable) => (
            <li key={variable.name}>
              <button
                type="button"
                onClick={() => onInsert(variable.name, variable.emailOnly)}
                title={`${variable.description}${variable.sample ? ` — e.g. ${variable.sample}` : ""}${variable.emailOnly ? " (email only)" : ""}`}
                className="inline-flex items-center gap-1 rounded-control border border-border bg-surface-sunken px-2 py-1 font-mono text-2xs text-ink transition-colors hover:border-border-strong hover:bg-surface-raised"
              >
                {`{{${variable.name}}}`}
                {variable.emailOnly ? (
                  <span className="font-sans text-ink-subtle">email</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </Card.Body>
    </Card.Root>
  );
}

function TemplateField({
  spec,
  value,
  error,
  register,
  onFocus,
  onChange,
}: {
  spec: FieldSpec;
  value: string;
  error: string | undefined;
  register: (element: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onFocus: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={spec.label} hint={spec.hint} error={error}>
      {spec.rows ? (
        <Textarea
          ref={register}
          rows={spec.rows}
          value={value}
          onFocus={onFocus}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          ref={register}
          value={value}
          onFocus={onFocus}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

function ResetDialog({
  detail,
  language,
  onClose,
  onReset,
}: {
  detail: TemplateDetail;
  language: TemplateLanguage;
  onClose: () => void;
  onReset: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    const result = await apiWrite(api.resetTemplate, {
      params: { key: detail.key, language },
    });
    setPending(false);
    if (!result.ok) return setProblem(result.form ?? "The template was not reset.");
    toast({
      title: `${detail.label} back to Rasi’s words in ${LANGUAGE_LABEL[language]}`,
      description: "The next one sent uses them.",
    });
    onReset();
  }

  const close = () => {
    if (!pending) onClose();
  };

  return (
    <Dialog
      open
      onClose={close}
      title="Use Rasi’s words?"
      description={`Your ${LANGUAGE_LABEL[language]} words for ${detail.label.toLowerCase()} are removed and Rasi’s own come back. The other language is not touched.`}
    >
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button tone="danger" onClick={() => void confirm()} disabled={pending}>
          {pending ? "Resetting…" : "Use Rasi’s words"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function register(
  map: Map<FieldName, HTMLInputElement | HTMLTextAreaElement>,
  name: FieldName,
  element: HTMLInputElement | HTMLTextAreaElement | null,
) {
  if (element) map.set(name, element);
  else map.delete(name);
}

const isInApp = (name: FieldName) => name === "title" || name === "body";

function sameContent(a: TemplateContentInput, b: TemplateContentInput): boolean {
  return (Object.keys(a) as FieldName[]).every((name) => a[name] === b[name]);
}
