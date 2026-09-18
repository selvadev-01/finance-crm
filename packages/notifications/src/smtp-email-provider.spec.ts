import { describe, expect, it } from "vitest";

import { MAX_ATTEMPTS, outcome } from "./delivery.js";
import {
  classifySmtpError,
  SmtpEmailProvider,
  type SmtpSend,
} from "./smtp-email-provider.js";

const settings = {
  host: "smtp.example.com",
  port: 587,
  secure: false,
  from: "Rasi <no-reply@example.com>",
};
const message = {
  to: "senior@example.com",
  subject: "Low collection on Line 3",
  text: "Suresh collected ₹80 of ₹100 from Guru",
  html: "<p>Suresh collected ₹80 of ₹100 from Guru</p>",
};

const failWith =
  (fields: object): SmtpSend =>
  async () => {
    throw Object.assign(new Error("mail server said no"), fields);
  };

describe("SMTP email provider (notifications.md#email)", () => {
  it("sends from the configured address, with the text and HTML parts", async () => {
    const calls: unknown[] = [];
    const provider = new SmtpEmailProvider(settings, async (mail) => {
      calls.push(mail);
    });
    await expect(provider.send(message)).resolves.toEqual({ status: "sent" });
    expect(calls).toEqual([{ from: settings.from, ...message }]);
  });

  it("leaves out the HTML part when there is none", async () => {
    const calls: Record<string, unknown>[] = [];
    const provider = new SmtpEmailProvider(settings, async (mail) => {
      calls.push(mail);
    });
    await provider.send({ to: "a@example.com", subject: "S", text: "T" });
    expect(calls[0]).not.toHaveProperty("html");
  });

  it.each([
    [{ responseCode: 421 }, "retry"],
    [{ responseCode: 450 }, "retry"],
    [{ responseCode: 452 }, "retry"],
    [{ responseCode: 550 }, "failed"],
    [{ responseCode: 553 }, "failed"],
    [{ code: "ECONNECTION" }, "retry"],
    [{ code: "ETIMEDOUT" }, "retry"],
    [{ code: "EDNS" }, "retry"],
    [{ code: "EAUTH" }, "retry"],
    // Gmail's wrong app password: a 5xx reply, but a login problem, not the message.
    [{ code: "EAUTH", responseCode: 535 }, "retry"],
    [{ code: "EENVELOPE" }, "failed"],
    [{ code: "EMESSAGE" }, "failed"],
    [{}, "retry"],
  ])("classifies %o as %s", async (fields, status) => {
    const provider = new SmtpEmailProvider(settings, failWith(fields));
    await expect(provider.send(message)).resolves.toMatchObject({ status });
  });

  it("puts the reply code in the reason, for the outbox row", () => {
    expect(
      classifySmtpError(
        Object.assign(new Error("mailbox unavailable"), { responseCode: 550 }),
      ),
    ).toEqual({
      status: "failed",
      reason: "550 mailbox unavailable",
    });
  });

  it("shares the push retry schedule: 1, 5, 30, 120 minutes, then gives up", () => {
    const now = new Date("2026-09-15T10:00:00Z");
    const retry = { status: "retry", reason: "421" } as const;
    expect(outcome(retry, 1, now)).toMatchObject({
      status: "PENDING",
      nextAttemptAt: new Date("2026-09-15T10:01:00Z"),
    });
    expect(outcome(retry, MAX_ATTEMPTS, now)).toMatchObject({
      status: "FAILED",
    });
    expect(outcome({ status: "failed", reason: "550" }, 1, now)).toMatchObject({
      status: "FAILED",
      lastError: "550",
    });
  });
});
