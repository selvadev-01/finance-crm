import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  firstFreeSlug,
  isValidSlug,
  RESERVED_SLUGS,
  randomSlug,
  slugFromName,
} from './organization-slug.js';
import { SignUpRateLimiter } from './sign-up-rate-limiter.js';

describe('organization slugs (ADR-0012)', () => {
  it.each([
    ['Lakshmi Finance', 'lakshmi-finance'],
    ['  Sri   Ganesh -- Chits  ', 'sri-ganesh-chits'],
    ['Śrī Lakshmi Finance & Co.', 'sri-lakshmi-finance-co'],
    ['ABC Traders (Madurai) Pvt. Ltd.', 'abc-traders-madurai-pvt-ltd'],
    ['Ünïcödé Café', 'unicode-cafe'],
    ['24x7 Daily Collections', '24x7-daily-collections'],
  ])('turns %j into %j', (name, slug) => {
    expect(slugFromName(name)).toBe(slug);
  });

  it.each(['லட்சுமி நிதி', '!!!', 'AB', ''])(
    'has no slug for %j, which keeps too little',
    (name) => {
      expect(slugFromName(name)).toBeNull();
    },
  );

  it('keeps a long name within the database limit, with room for a suffix', () => {
    const slug = slugFromName('Very Long Business Name '.repeat(10))!;
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(isValidSlug(firstFreeSlug(slug, new Set([slug])))).toBe(true);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('every generated slug satisfies organization_slug_format_check', () => {
    for (const name of ['A1 Finance', 'x'.repeat(200), 'a - b - c', 'Café 9']) {
      const slug = slugFromName(name);
      if (slug) expect(isValidSlug(slug)).toBe(true);
    }
    expect(isValidSlug(randomSlug())).toBe(true);
    expect(randomSlug()).toMatch(/^org-[0-9a-f]{8}$/);
  });

  it('uses the base when free, and numbers past the taken ones', () => {
    expect(firstFreeSlug('lakshmi', new Set())).toBe('lakshmi');
    expect(firstFreeSlug('lakshmi', new Set(['lakshmi']))).toBe('lakshmi-2');
    expect(
      firstFreeSlug('lakshmi', new Set(['lakshmi', 'lakshmi-2', 'lakshmi-3'])),
    ).toBe('lakshmi-4');
    // A gap is reused.
    expect(firstFreeSlug('lakshmi', new Set(['lakshmi', 'lakshmi-3']))).toBe(
      'lakshmi-2',
    );
  });

  it('never returns a reserved word, even when nobody has it', () => {
    for (const reserved of ['dashboard', 'sign-in', 'api', 'route', 'admin']) {
      expect(RESERVED_SLUGS.has(reserved)).toBe(true);
      expect(firstFreeSlug(reserved, new Set())).toBe(`${reserved}-2`);
    }
  });

  it('reserves every top-level route of the web app, so no slug can shadow one', () => {
    const app = join(import.meta.dirname, '../../../web/app');
    const segments = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) =>
          // A route group `(name)` adds no URL segment: its children are top-level.
          /^\(.*\)$/.test(entry.name)
            ? segments(join(dir, entry.name))
            : [entry.name],
        )
        // Dynamic segments (`[slug]`) and private folders (`_organisation`) are not URLs.
        .filter((name) => !name.startsWith('[') && !name.startsWith('_'));

    const unreserved = segments(app).filter(
      (name) => !RESERVED_SLUGS.has(name),
    );
    expect(unreserved).toEqual([]);
  });

  it('falls back to a random suffix past 99 collisions', () => {
    const taken = new Set(['busy']);
    for (let n = 2; n < 100; n += 1) taken.add(`busy-${n}`);
    const slug = firstFreeSlug('busy', taken);
    expect(slug).toMatch(/^busy-[0-9a-f]{6}$/);
    expect(taken.has(slug)).toBe(false);
  });
});

describe('SignUpRateLimiter (ADR-0012)', () => {
  it('allows the limit per address, then refuses until the window passes', () => {
    const limiter = new SignUpRateLimiter({ limit: 2, windowMs: 1_000 });
    expect(limiter.tryConsume('10.0.0.1', 0)).toBe(true);
    expect(limiter.tryConsume('10.0.0.1', 10)).toBe(true);
    expect(limiter.tryConsume('10.0.0.1', 20)).toBe(false);
    // Another address has its own window.
    expect(limiter.tryConsume('10.0.0.2', 20)).toBe(true);
    // A new window opens once the old one has passed.
    expect(limiter.tryConsume('10.0.0.1', 1_000)).toBe(true);
  });
});
