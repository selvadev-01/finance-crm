import { defineConfig } from "vitest/config";

/**
 * Component tests run in jsdom. It has no layout and no top layer, so the
 * setup file fills in the few browser APIs the components touch
 * (`showModal`, `ResizeObserver`, pointer capture); anything that depends on
 * real layout is checked in a browser instead (design-system.md#testing).
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    // Vitest blanks CSS by default; theme.test.ts reads the tokens as text.
    css: { include: [/theme\.css/] },
  },
});
