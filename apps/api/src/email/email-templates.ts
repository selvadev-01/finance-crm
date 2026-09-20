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
        `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(paragraph)}</p>`,
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
 * US-003: the link that lets someone set a new password themselves. The
 * wording carries the two facts that matter to a Junior standing on a round —
 * how long the link lasts, and that ignoring it changes nothing.
 */
export function passwordResetEmail(input: {
  name: string;
  resetUrl: string;
  validForMinutes: number;
}): RenderedEmail {
  return render({
    subject: 'Set a new Rasi password',
    heading: 'Set a new password',
    paragraphs: [
      `Hello ${input.name},`,
      `Use the button below to set a new password. The link works once and lasts ${input.validForMinutes} minutes.`,
      `If you did not ask for this, ignore this email — your password stays as it is.`,
    ],
    action: { label: 'Set a new password', url: input.resetUrl },
    footer:
      'You are receiving this because someone asked to reset the password for this Rasi account. Tell your Admin if it was not you.',
  });
}

/** A copy of an in-app notification (M10). The app remains the record. */
export function notificationEmail(input: {
  title: string;
  body: string;
  url: string;
  organizationName: string;
}): RenderedEmail {
  return render({
    subject: `${input.title} — ${input.organizationName}`,
    heading: input.title,
    paragraphs: [input.body],
    action: { label: 'View in Rasi', url: input.url },
    footer: `An alert from ${input.organizationName} on Rasi. Alerts are always emailed and cannot be switched off; the same alert is in your notifications in the app.`,
  });
}
