import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    environment: "node",
    globals: false,
    testTimeout: 10000,
    setupFiles: ["test/setup.ts"],
  },
});
