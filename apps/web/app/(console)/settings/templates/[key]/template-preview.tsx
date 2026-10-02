"use client";

import { Bell } from "@phosphor-icons/react/dist/ssr";
import {
  type NotificationCategory,
  notificationTemplateContract as api,
  type TemplateContentInput,
  type TemplateLanguage,
  type TemplatePreview as Preview,
} from "@repo/contracts";
import { Badge, Card, Section, Skeleton } from "@repo/ui";
import { useEffect, useState } from "react";

import { apiWrite } from "../../../../../lib/api-write";
import {
  CATEGORY_LABEL,
  CATEGORY_TONE,
} from "../../../../../lib/notifications/notification-list";
type FieldName = keyof TemplateContentInput;
type Problems = Partial<Record<FieldName, string>>;

/** The API's details as one message per field; `content.title` → `title`. */
export function fieldIssues(
  details: readonly { field: string; issue: string }[],
): Problems {
  const issues: Problems = {};
  for (const detail of details) {
    const name = detail.field.replace(/^content\./, "") as FieldName;
    issues[name] ??= detail.issue.charAt(0).toUpperCase() + detail.issue.slice(1);
  }
  return issues;
}

export type PreviewState =
  | { status: "loading"; problems: Problems }
  | { status: "ready"; preview: Preview; problems: Problems }
  | { status: "invalid"; problems: Problems }
  | { status: "error"; message: string; problems: Problems };

/** How long typing must pause before the preview is asked for again. */
const PAUSE_MS = 400;

/**
 * The unsaved words rendered by the API with sample values (US-074), a moment
 * after typing stops. A problem comes back by field, so the editor marks it
 * where it is while the Super Admin is still typing.
 */
export function usePreview(
  key: string,
  language: TemplateLanguage,
  content: TemplateContentInput,
): PreviewState {
  return usePreviewOf(JSON.stringify({ key, language, content }));
}

/** The same, keyed by the serialized request, so an equal draft is not re-asked. */
function usePreviewOf(request: string): PreviewState {
  const [state, setState] = useState<{ request: string; state: PreviewState } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    const body = JSON.parse(request) as {
      key: string;
      language: TemplateLanguage;
      content: TemplateContentInput;
    };
    const timer = setTimeout(() => {
      void apiWrite(api.previewTemplate, {
        params: { key: body.key },
        body: { language: body.language, content: body.content },
      }).then((result) => {
        if (cancelled) return;
        setState({
          request,
          state: result.ok
            ? { status: "ready", preview: result.body, problems: {} }
            : result.status === 400 || result.status === 422
              ? { status: "invalid", problems: fieldIssues(result.details) }
              : {
                  status: "error",
                  message: result.form ?? "The preview could not be shown.",
                  problems: {},
                },
        });
      });
    }, PAUSE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [request]);

  // Keep showing the last preview while the next one is on its way.
  if (state === null) return { status: "loading", problems: {} };
  if (state.request === request) return state.state;
  return state.state.status === "ready" ? state.state : { status: "loading", problems: {} };
}

export function TemplatePreview({
  preview,
  category,
}: {
  preview: PreviewState;
  category: NotificationCategory | null;
}) {
  return (
    <aside className="flex min-w-0 flex-col gap-[var(--section-gap)] xl:sticky xl:top-4 xl:self-start">
      <Section
        as="h3"
        title="Preview"
        description="With sample values. Each person sees their own."
      >
        {preview.status === "loading" ? <Skeleton className="h-40" /> : null}
        {preview.status === "invalid" ? (
          <p className="text-caption text-critical">
            Fix the marked fields to see the preview.
          </p>
        ) : null}
        {preview.status === "error" ? (
          <p className="text-caption text-critical">{preview.message}</p>
        ) : null}
        {preview.status === "ready" ? (
          <div className="flex flex-col gap-4">
            {preview.preview.title !== null ? (
              <Card.Root>
                <Card.Body className="flex gap-3">
                  <Bell aria-hidden size={18} className="mt-0.5 shrink-0 text-ink-muted" />
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-label text-ink">{preview.preview.title}</span>
                      {category ? (
                        <Badge tone={CATEGORY_TONE[category]}>
                          {CATEGORY_LABEL[category]}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-caption whitespace-pre-line text-ink-muted">
                      {preview.preview.body}
                    </p>
                  </div>
                </Card.Body>
              </Card.Root>
            ) : null}
            <div className="flex flex-col gap-2">
              <p className="text-caption text-ink-muted">
                Subject:{" "}
                <span className="text-ink">{preview.preview.email.subject}</span>
              </p>
              {/* No scripts, no same-origin: the email is shown, never run. */}
              <iframe
                title="Email preview"
                sandbox=""
                srcDoc={preview.preview.email.html}
                className="h-[26rem] w-full rounded-control border border-border bg-surface"
              />
            </div>
          </div>
        ) : null}
      </Section>
    </aside>
  );
}
