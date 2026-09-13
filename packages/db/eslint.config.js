import { config } from "@repo/eslint-config/base";
import globals from "globals";

export default [
  // The Prisma client is generated, not authored. Linting it is noise.
  { ignores: ["src/generated/**", "dist/**"] },
  ...config,
  // @repo/db runs in Node and reads process.env for the connection string.
  {
    files: ["**/*.ts"],
    languageOptions: { globals: globals.node },
  },
];
