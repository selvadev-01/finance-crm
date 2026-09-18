/**
 * `@repo/notifications` — push and email delivery behind small interfaces
 * (M10, notifications.md). Framework-free and tested against fake transports;
 * the API owns the rows, the recipients and the schedule.
 */
export { deliver, MAX_ATTEMPTS, type Outcome, outcome } from "./delivery.js";
export {
  type FcmCredentials,
  FcmProvider,
  type FcmSend,
} from "./fcm-provider.js";
export { isKnownPushEndpoint } from "./push-endpoint.js";
export {
  classifySmtpError,
  type EmailMessage,
  type EmailProvider,
  type EmailResult,
  SmtpEmailProvider,
  type SmtpSend,
  type SmtpSettings,
} from "./smtp-email-provider.js";
export type {
  ProviderName,
  PushPayload,
  PushProvider,
  PushResult,
  PushTarget,
} from "./types.js";
export {
  type VapidKeys,
  WebPushProvider,
  type WebPushSend,
} from "./web-push-provider.js";
