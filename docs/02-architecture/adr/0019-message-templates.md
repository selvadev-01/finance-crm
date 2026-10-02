# ADR-0019 — Message templates per business, rendered per reader, stored as sent

**Status:** Accepted · 2026-10-02 · Extends [M10](../../01-product/modules/M10-notifications.md); replaces the fixed category table in [notifications.md](../notifications.md#what-is-pushed) with a per-business default

## Context

Every notification's words were written in code. `EventNotices` built each title and body with template literals, and `email-templates.ts` held the email layout and its two transactional emails. Which channels a message used followed a fixed table on its category: ALERT and WARNING pushed, ALERT alone emailed.

The owner asked for a template manager for the whole application, over email and Web Push (2026-10-02). They decided four things:

- Templates belong to **each business**, and only its **Super Admin** edits them.
- Push and in-app words, email words, **per-message channel switches** and the transactional emails are all editable.
- Every message comes in **English and Tamil**.
- Email is built from **structured fields**, not from HTML.

Three of those cut across settled rules:

- **Channels.** The categories' push and email rules were a mitigation for alert fatigue (M10 risks).
- **Language.** There was none: every staff member read the same English.
- **Storage.** A notification's text was computed once and stored. Templates would let it be re-derived instead.

## Decision

**Every message Rasi sends has a key in a code-owned catalogue, with English and Tamil defaults. A business stores overrides only. Each recipient's copy is rendered from the business's template, in their own language, inside the event's transaction, and stored as text.**

- **The catalogue is code; overrides are data.** `apps/api/src/notifications/templates/catalogue.ts` defines each message: its key, its category and event type, its placeholders with sample values, and its defaults in both languages.
  - `notification_template` holds a business's own words for one key in one language. `notification_channel` holds its push and email choice for one key. No row means the default.
  - This is the same shape as M15's settings registry, and for the same reason: the default is the rest of the system's contract, and an override can always be dropped back to it.
- **A message is finer than an event.** `EXPENSE_DECIDED` is two messages, approved and rejected; the same goes for a correction and a reversal, cash short and cash over, and a new account and a running one. Each message has exactly one category, so its channel defaults and its lock are fixed.
  - The `NotificationEvent` enum is unchanged. It still classifies the notification row.
- **The English defaults are the old wording, character for character.** One wording change: the reconciliation summary is now three sentences instead of a `;`-joined list, so it can be written in any language.
- **A small placeholder language.** It has three forms:
  - `{{name}}` inserts the value.
  - `{{#name}}…{{/name}}` shows the words only when `name` has a value.
  - `{{^name}}…{{/name}}` shows them only when it has none.

  That is enough for plurals and optional clauses in both languages without the code composing English phrases. Values arrive pre-formatted, with money through `rupees`, so the template engine never sees a number.

- **Strict on save, total on send.** Saving refuses a placeholder the message does not offer, an unclosed section, and push words on an email-only message, naming the field (`422 TEMPLATE_INVALID`).
  - Rendering never throws, because it runs inside a collection's or a handover's transaction. A placeholder dropped from a later catalogue renders as nothing. A field that renders blank falls back to the default's words.
- **Rendered per recipient, in their language, and stored as text.** `staff_profile.language` (`EN` | `TA`) is each person's own choice. It is on `/settings/notifications` in the console and on the Junior's Profile.
  - The notification row and the email row keep the words they were sent with. Editing a template never rewrites a notification already in someone's centre: the centre is the record.
- **Email is fields poured into the fixed layout.** The fields are subject, heading, paragraphs (separated by a blank line), button label and footer. No HTML is written or accepted, and every value is escaped once, by the layout.
  - The button's link is not a template field. A template cannot send staff anywhere but the subject in Rasi.
- **Channels are the business's choice per message, defaulting from the category.** The defaults stay as before: ALERT and WARNING pushed, ALERT emailed. Two cases are locked:
  - **An ALERT is always pushed and emailed.** That is US-073's rule one level up: the business exists to act on low collections, missed visits and cash differences, and an owner switching those off would recreate the paper process. It is refused at the API (`422 CHANNEL_LOCKED`), and the resolver holds an ALERT on even if a row says otherwise.
  - **A password reset is always emailed.**
- **The welcome email is not a template.** It is sent in the transaction that creates the business, before that business could have written anything.
- **Super Admin only, audited.** `notificationTemplate.view` covers the list, the editor and the preview. `notificationTemplate.manage` covers save, reset, channels and test. Saves, resets and channel changes are audited with before and after.
  - The preview writes nothing.
  - "Send a test" goes only to the caller, marked "Test", and writes only their own notification and outbox rows.

## Consequences

- A business can reword any message without a deployment, and a Tamil-reading Junior reads Tamil.
- **The Tamil defaults were written with this feature and have not been read by a native speaker.** They are a starting point; the Super Admin can correct each one on the same screen.
- Raising a notification now reads the template and channel rows: two indexed lookups per message per business, inside the event's transaction. Rendering happens once per language, not once per recipient.
- Preferences report a category as "pushed" or "emailed" when any of its messages is. With per-message channels this is a summary, not a rule.
- Adding a message means adding a catalogue entry with both languages. `catalogue.spec.ts` fails if a default does not parse, breaks a contract limit or leaves a placeholder unrendered. It also fails if a notification event has no message.
- Renaming or removing a placeholder strands any override that used it. The override renders the placeholder as nothing, and the editor marks it on the next save.
