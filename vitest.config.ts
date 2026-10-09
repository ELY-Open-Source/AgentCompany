import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/{unit,contract,integration,live}/**/*.test.ts"],
    testTimeout: 30_000,
    // Each worker opens its own databases; a core-count pool thrashes a shared CI machine.
    maxWorkers: 8,
  },
});
