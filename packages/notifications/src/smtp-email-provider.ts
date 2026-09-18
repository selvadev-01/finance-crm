import nodemailer from "nodemailer";

import type { PushResult } from "./types.js";

/** One email, already rendered. `to` is a bare address; `from` comes from the settings. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** An email either went, may go later, or will never go. There is no device to forget. */
export type EmailResult = Exclude<PushResult, { status: "gone" }>;

export interface EmailProvider {
  readonly name: "SMTP";
  send(message: EmailMessage): Promise<EmailResult>;
}

export interface SmtpSettings {
  host: string;
  port: number;
  /** `true` for implicit TLS (port 465); `false` upgrades with STARTTLS (587). */
  secure: boolean;
  /** Both or neither: an open relay needs no login. */
  auth?: { user: string; pass: string };
  /** `Rasi <no-reply@example.com>`. */
  from: string;
}

/** The one call this provider makes; injected so tests use a fake transport. */
export type SmtpSend = (mail: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}) => Promise<unknown>;

/** Give up on a server that accepts the connection and then says nothing. */
const TIMEOUT_MS = 30_000;

/**
 * Email over SMTP with Nodemailer (notifications.md#email). Any SMTP service
 * works — a company mail server, Amazon SES, Gmail with an app password, or
 * Mailpit on a laptop. The transport is pooled, so a batch of emails reuses
 * one connection.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = "SMTP" as const;
  private readonly transport: SmtpSend;

  constructor(
    private readonly settings: SmtpSettings,
    transport?: SmtpSend,
  ) {
    if (transport) {
      this.transport = transport;
      return;
    }
    const transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      ...(settings.auth ? { auth: settings.auth } : {}),
      pool: true,
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
    this.transport = (mail) => transporter.sendMail(mail);
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    try {
      await this.transport({
        from: this.settings.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
      return { status: "sent" };
    } catch (error) {
      return classifySmtpError(error);
    }
  }
}

/** Connection-level trouble that another attempt, later, may not meet. */
const RETRY_CODES = new Set([
  "ECONNECTION",
  "ETIMEDOUT",
  "ESOCKET",
  "EDNS",
  "ETLS",
  "EPROTOCOL",
  "EAUTH",
  "ENOAUTH",
]);

/**
 * SMTP's own convention decides first: a 4xx reply is a temporary refusal
 * (greylisting, a full mailbox, rate limiting), a 5xx reply is permanent (no
 * such mailbox, message rejected). Without a reply code, Nodemailer's error
 * code says whether it was the connection — retried, including a login
 * failure, which is a configuration mistake an operator can fix before the
 * attempts run out — or the message itself, which will never improve.
 */
export function classifySmtpError(error: unknown): EmailResult {
  const { responseCode, code } = error as {
    responseCode?: unknown;
    code?: unknown;
  };
  const detail = error instanceof Error ? error.message : String(error);
  // A rejected login arrives as a 5xx reply (Gmail: 535 5.7.8), but it is the
  // server's password that is wrong, not the message: keep the email queued.
  if (code === "EAUTH" || code === "ENOAUTH") {
    return {
      status: "retry",
      reason: `${typeof responseCode === "number" ? `${responseCode} ` : ""}${detail}`,
    };
  }
  if (typeof responseCode === "number") {
    const reason = `${responseCode} ${detail}`;
    return responseCode >= 400 && responseCode < 500
      ? { status: "retry", reason }
      : { status: "failed", reason };
  }
  if (typeof code === "string") {
    return RETRY_CODES.has(code)
      ? { status: "retry", reason: `${code} ${detail}` }
      : { status: "failed", reason: `${code} ${detail}` };
  }
  return { status: "retry", reason: detail };
}
