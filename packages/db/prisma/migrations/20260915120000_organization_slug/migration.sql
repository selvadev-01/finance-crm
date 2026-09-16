-- organization.slug (ADR-0012): the organization's public identity, used in
-- its sign-in link (`/<slug>/sign-in`). Generated from the name by sign-up;
-- never typed by a person.
--
-- Rows written before this column, and rows created outside sign-up (the seed,
-- test fixtures), get a random `org-` slug from the column default.

ALTER TABLE "organization" ADD COLUMN "slug" TEXT;

UPDATE "organization"
  SET "slug" = 'org-' || substr(md5(random()::text || "id"), 1, 12);

ALTER TABLE "organization"
  ALTER COLUMN "slug" SET NOT NULL,
  ALTER COLUMN "slug" SET DEFAULT ('org-' || substr(md5(random()::text), 1, 12));

CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");
