// Prisma 7 configuration.
//
// Prisma 7 removed `url` from the datasource block in schema.prisma, so the
// connection string for migration and introspection commands lives here.
// The runtime client takes a driver adapter instead — see src/index.ts.
//
// `.env` is not loaded automatically, and dotenv resolves it from the working
// directory — which is packages/db when the Prisma CLI runs, not the repo root
// where .env actually lives. Resolve it relative to this file instead, so the
// commands work from anywhere.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../.env",
  ),
});

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // One database, two schemas. DATABASE_URL carries `?schema=public` for
    // development; the test harness passes TEST_DATABASE_URL with
    // `?schema=test`. See .env.example.
    url: process.env["DATABASE_URL"],
  },
});
