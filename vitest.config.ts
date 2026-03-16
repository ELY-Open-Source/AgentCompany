import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve("src/shared"),
      "@main": resolve("src/main"),
      "@renderer": resolve("src/renderer"),
      "@preload": resolve("src/preload"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.{spec,test}.ts"],
    exclude: ["tests/e2e/**"],
    restoreMocks: true,
  },
});
