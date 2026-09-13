import { readdirSync } from "node:fs";

/**
 * The migrations this build of `@repo/db` ships, by directory name, oldest
 * first.
 *
 * `/health/ready` compares these with `_prisma_migrations` to report whether
 * the database is current (M16). Resolved from the compiled file's location
 * (`dist/` → `../prisma/migrations`), so it lists what was deployed rather
 * than what happens to be in the working directory.
 */
export function listMigrationNames(): string[] {
  const directory = new URL("../prisma/migrations/", import.meta.url);
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
