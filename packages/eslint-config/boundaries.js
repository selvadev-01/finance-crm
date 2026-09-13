/**
 * Package boundary rules (coding-guidelines.md).
 *
 * | Package             | May import                        | Must not import          |
 * | ------------------- | --------------------------------- | ------------------------ |
 * | packages/domain     | decimal.js and date utilities     | Prisma, NestJS, anything |
 * | packages/contracts  | Zod                               | Prisma, NestJS           |
 * | packages/db         | Prisma                            | application code         |
 * | apps/api            | all packages                      | apps/web                 |
 * | apps/web            | contracts, ui, domain             | db, apps/api             |
 *
 * **Dependency hygiene is the primary control, not this file.** `.npmrc` is
 * empty, so pnpm's isolated node_modules means a package can only import what
 * its own package.json declares. Give @repo/domain dependencies of exactly
 * decimal.js plus date utilities, and `import { PrismaClient } from
 * "@prisma/client"` is an unresolvable module — a hard tsc error with no rule
 * to configure and no disable comment that silences it.
 *
 * These lint rules cover the residue that dependency hygiene cannot: deep-path
 * escapes, re-exports through another package, and transitive leakage where a
 * forbidden package happens to be installed as someone else's dependency.
 *
 * Deliberately built on ESLint core `no-restricted-imports` — no plugins, no
 * type information, works under the existing @babel/eslint-parser. Reaching
 * for typescript-eslint or import/no-restricted-paths would mean swapping the
 * parser and betting a foundation rule on type-aware linting under the
 * brand-new TypeScript 7 native port. None of these rules need types.
 *
 * NOTE: base.js registers eslint-plugin-only-warn, which downgrades every rule
 * to a warning. These rules therefore only *fail* where the package script
 * passes `--max-warnings 0`. Every package ships that flag; if you add a new
 * one without it, the boundary silently stops being enforced.
 */

import babelParser from "@babel/eslint-parser";

/**
 * Flat config applies a block with no `files` key to `**\/*.{js,mjs,cjs}` only
 * — never to `.ts`. base.js sets no `files` anywhere, so despite configuring a
 * TypeScript-capable parser it lints no TypeScript at all: ESLint reports
 * "File ignored because no matching configuration was supplied" for every .ts
 * file in the repository.
 *
 * Each boundary block below therefore carries its own `files` glob and parser,
 * so these rules apply to the source they exist to police. Without this they
 * are decorative.
 */
const TS_FILES = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

const tsLanguageOptions = {
  parser: babelParser,
  parserOptions: {
    requireConfigFile: false,
    babelOptions: { presets: ["@babel/preset-typescript"] },
  },
};

const FRAMEWORK = [
  { group: ["@prisma/*", "prisma", "prisma/*"], message: "Prisma may not be imported here. Only packages/db talks to Prisma." },
  { group: ["@nestjs/*"], message: "NestJS may not be imported here — it would make this package untestable without an application context." },
  { group: ["@repo/db", "@repo/db/*"], message: "@repo/db may not be imported here." },
];

/** Rules for packages/domain — the strictest boundary in the repository. */
export const domainBoundaries = {
  files: TS_FILES,
  languageOptions: tsLanguageOptions,
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          ...FRAMEWORK,
          {
            group: ["@repo/contracts", "@repo/contracts/*", "zod"],
            message:
              "packages/domain may import decimal.js and date utilities only. Validation belongs in @repo/contracts, which depends on domain rather than the other way round.",
          },
          {
            group: ["@repo/ui", "@repo/ui/*", "react", "react-dom", "next", "next/*"],
            message: "packages/domain is framework-free. No UI, no React, no Next.",
          },
        ],
      },
    ],
  },
};

/** Rules for packages/contracts — Zod, and nothing else. */
export const contractsBoundaries = {
  files: TS_FILES,
  languageOptions: tsLanguageOptions,
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          ...FRAMEWORK,
          {
            group: ["@repo/ui", "@repo/ui/*", "react", "react-dom", "next", "next/*"],
            message: "packages/contracts is shared by both sides. No UI imports.",
          },
        ],
      },
    ],
  },
};

/** Rules for apps/web — must not reach the database or the API's internals. */
export const webBoundaries = {
  files: TS_FILES,
  languageOptions: tsLanguageOptions,
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@repo/db", "@repo/db/*", "@prisma/*", "prisma", "prisma/*"],
            message:
              "apps/web must not hold a database client. Go through the API — the browser has no business with a connection string.",
          },
          {
            group: ["api", "api/*", "@nestjs/*"],
            message: "apps/web must not import from apps/api. Share types through @repo/contracts.",
          },
        ],
      },
    ],
  },
};
