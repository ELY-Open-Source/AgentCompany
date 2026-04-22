import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  dependencies?: Record<string, string>;
};

const PI_RUNTIME_PACKAGES = [
  "@mariozechner/pi-agent-core",
  "@mariozechner/pi-ai",
  "@mariozechner/pi-coding-agent",
] as const;

function readRootPackage(): PackageJson {
  return JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as PackageJson;
}

describe("pi runtime dependency contract", () => {
  it("keeps the shipping pi runtime on exact npm package pins", () => {
    const dependencies = readRootPackage().dependencies ?? {};

    for (const packageName of PI_RUNTIME_PACKAGES) {
      expect(dependencies[packageName]).toBe("0.67.68");
      expect(dependencies[packageName]).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
