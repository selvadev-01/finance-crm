import { webBoundaries } from "@repo/eslint-config/boundaries";
import { nextJsConfig } from "@repo/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [...nextJsConfig, webBoundaries];
