-- US-074 notification template invariants. Specs in
-- apps/api/test/db-constraints/notification-templates.spec.ts.
--
-- The API validates a template's placeholders against the catalogue; the
-- database holds what does not depend on the catalogue — a key's shape, that
-- in-app text comes as a title and body together, and the length limits that
-- keep a push readable and an email one screen long.

-- ---------------------------------------------------------------------------
-- 1. A key is a catalogue key: upper-case words joined by underscores.
-- ---------------------------------------------------------------------------

ALTER TABLE "notification_template"
  ADD CONSTRAINT "notification_template_key_format_check"
    CHECK ("key" ~ '^[A-Z][A-Z_]{0,63}$');

ALTER TABLE "notification_channel"
  ADD CONSTRAINT "notification_channel_key_format_check"
    CHECK ("key" ~ '^[A-Z][A-Z_]{0,63}$');

-- ---------------------------------------------------------------------------
-- 2. In-app text is a title and a body, or neither (an email-only message).
-- ---------------------------------------------------------------------------

ALTER TABLE "notification_template"
  ADD CONSTRAINT "notification_template_push_pair_check"
    CHECK (("title" IS NULL) = ("body" IS NULL));

-- ---------------------------------------------------------------------------
-- 3. Every part is non-blank and within the limits the contract states.
-- ---------------------------------------------------------------------------

ALTER TABLE "notification_template"
  ADD CONSTRAINT "notification_template_length_check"
    CHECK (
      ("title" IS NULL OR char_length(btrim("title")) BETWEEN 1 AND 120)
      AND ("body" IS NULL OR char_length(btrim("body")) BETWEEN 1 AND 500)
      AND char_length(btrim("emailSubject")) BETWEEN 1 AND 150
      AND char_length(btrim("emailHeading")) BETWEEN 1 AND 150
      AND char_length(btrim("emailBody")) BETWEEN 1 AND 3000
      AND char_length(btrim("emailAction")) BETWEEN 1 AND 40
      AND char_length(btrim("emailFooter")) BETWEEN 1 AND 500
    );
