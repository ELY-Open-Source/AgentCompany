import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/{unit,contract,integration,live}/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
