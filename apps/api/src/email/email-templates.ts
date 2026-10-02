/**
 * Email content (notifications.md#email). Pure functions: every email has a
 * plain-text part, which is what gets read on a basic phone, and a minimal
 * HTML part with no images, no tracking and no external styles.
 *
 * The HTML uses inline literal colours on purpose: mail clients ignore
 * stylesheets and CSS variables, so the `@repo/ui` tokens cannot reach an
 * inbox. The design-system rule against hard-coded hex values is for the web
 * app, not for email.
 *
 * **Never put a figure in an email the recipient could not see in the app.**
 * Notification emails carry the notification's own title and body, which were
 * written for that recipient (notifications.md#payload).
 */

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

interface Layout {
  subject: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footer: string;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Every interpolated value goes through this — names and titles are user input. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * A subject is one header line: a line break in a business name must not
 * become a second header.
 */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Paragraphs from a template's email body (US-074): separated by a blank line.
 * A single line break stays inside its paragraph.
 */
function paragraphsOf(body: string): string[] {
  return body
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');
}

function render(layout: Layout): RenderedEmail {
  const text = [
    layout.heading,
    '',
    ...layout.paragraphs.flatMap((paragraph) => [paragraph, '']),
    ...(layout.action
      ? [`${layout.action.label}: ${layout.action.url}`, '']
      : []),
    '—',
    layout.footer,
  ].join('\n');

  const html = [
    '<!doctype html>',
    '<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2933">',
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e7eb;border-radius:8px;padding:24px">',
    `<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(layout.heading)}</h1>`,
    ...layout.paragraphs.map(
      (paragraph) =>
        `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(paragraph).replace(/\r?\n/g, '<br>')}</p>`,
    ),
    ...(layout.action
      ? [
          `<p style="margin:20px 0"><a href="${escapeHtml(layout.action.url)}" style="display:inline-block;background:#1f4e8c;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px">${escapeHtml(layout.action.label)}</a></p>`,
        ]
      : []),
    `<p style="margin:16px 0 0;font-size:12px;color:#616e7c">${escapeHtml(layout.footer)}</p>`,
    '</div></body></html>',
  ].join('');

  return { subject: oneLine(layout.subject), text, html };
}

/** To an organization's owner, the moment their business exists (US-006). */
export function welcomeEmail(input: {
  ownerName: string;
  organizationName: string;
  signInUrl: string;
}): RenderedEmail {
  return render({
    subject: `Welcome to Rasi — ${input.organizationName}`,
    heading: `${input.organizationName} is ready`,
    paragraphs: [
      `Hello ${input.ownerName},`,
      `Your business is set up on Rasi and you are its Super Admin. Start by adding your sectors and lines.`,
      `Your staff sign in at your business's own link. Share it with them:`,
      input.signInUrl,
    ],
    action: { label: 'Open Rasi', url: input.signInUrl },
    footer:
      'You are receiving this because this email address was used to sign up a business on Rasi. If that was not you, reply to let us know.',
  });
}

/**
 * An email written from a template (US-074) — a notification's copy, or the
 * password-reset link. The fields arrive already rendered as plain text and
 * are escaped here, once; the link is never a template field, so a template
 * cannot point a button anywhere but Rasi.
 */
export function templatedEmail(input: {
  subject: string;
  heading: string;
  body: string;
  action: string;
  footer: string;
  url: string;
}): RenderedEmail {
  return render({
    subject: input.subject,
    heading: input.heading,
    paragraphs: paragraphsOf(input.body),
    action: { label: input.action, url: input.url },
    footer: input.footer,
  });
}
