import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("preload bundling contract", () => {
  it("delegates preload IPC validation through the shared forwarder registry", () => {
    const configSource = readFileSync(join(process.cwd(), "electron.vite.config.ts"), "utf8");
    const preloadSource = readFileSync(join(process.cwd(), "src/preload/index.ts"), "utf8");

    expect(configSource).toContain('exclude: ["zod"]');
    expect(preloadSource).toContain("PRELOAD_INPUT_SCHEMAS");
    expect(preloadSource).not.toContain('from "@shared/contracts"');
    expect(preloadSource).not.toMatch(/from ["']zod["']|require\(["']zod["']\)/);
  });
});
