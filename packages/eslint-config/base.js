import babelParser from "@babel/eslint-parser";
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import onlyWarn from "eslint-plugin-only-warn";

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
/**
 * Files every block below applies to.
 *
 * Flat config applies a block with no `files` key to `**\/*.{js,mjs,cjs}` and
 * nothing else. Without this constant the TypeScript parser configured below
 * never reaches a TypeScript file, and ESLint silently reports
 * "File ignored because no matching configuration was supplied" while exiting
 * 0 — so `pnpm lint` passes having checked almost nothing.
 */
export const LINTED_FILES = [
  "**/*.js",
  "**/*.mjs",
  "**/*.cjs",
  "**/*.jsx",
  "**/*.ts",
  "**/*.mts",
  "**/*.cts",
  "**/*.tsx",
];

export const config = [
  js.configs.recommended,
  eslintConfigPrettier,
  {
    files: LINTED_FILES,
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: ["@babel/preset-typescript"],
        },
      },
    },
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
  {
    // JSX needs the TypeScript preset told it is parsing TSX, or every generic
    // and every type annotation in a .tsx file reads as a syntax error.
    files: ["**/*.tsx", "**/*.jsx"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          // Babel 8 removed .isTSX / .allExtensions; TSX is detected from the
          // file extension instead, and preset-react supplies JSX parsing.
          presets: ["@babel/preset-typescript", "@babel/preset-react"],
        },
      },
    },
  },
  {
    files: ["**/*.ts", "**/*.mts", "**/*.cts", "**/*.tsx"],
    rules: {
      // Core ESLint cannot see type positions. It reports every type name,
      // interface and type-only import as an undefined or unused variable,
      // which is noise rather than signal.
      //
      // TypeScript performs both checks properly and already runs as
      // `pnpm check-types`, so these are switched off for TypeScript only —
      // they remain active on plain JavaScript. Replacing them with the
      // typescript-eslint equivalents means swapping the parser, which is a
      // deliberate later decision (coding-guidelines.md).
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
  {
    plugins: {
      onlyWarn,
    },
  },
  {
    ignores: ["dist/**"],
  },
];
