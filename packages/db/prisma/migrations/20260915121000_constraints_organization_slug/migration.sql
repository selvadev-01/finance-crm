-- organization.slug shape (ADR-0012): lowercase letters and digits in
-- hyphen-separated groups, 3 to 63 characters — safe as a URL path segment and
-- as a DNS label, should slugs ever move to subdomains.

ALTER TABLE "organization"
  ADD CONSTRAINT "organization_slug_format_check"
    CHECK (
      "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      AND char_length("slug") BETWEEN 3 AND 63
    );
