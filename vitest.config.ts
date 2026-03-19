import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    environment: "node",
    globals: false,
    testTimeout: 10000,
    setupFiles: ["test/setup.ts"],
    // Many test files call resetConfig() which clears the global config
    // singleton. Running files in parallel causes race conditions where
    // one file's resetConfig() breaks another file's getConfig() call.
    fileParallelism: false,
  },
});
