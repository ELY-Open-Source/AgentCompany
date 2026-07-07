import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

interface PackageManifest {
  main: string;
  scripts: Record<string, string>;
}

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readPackageManifest(): PackageManifest {
  return JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as PackageManifest;
}

function readBuilderConfig(): string {
  return readFileSync(join(projectRoot, "electron-builder.yml"), "utf8");
}

function topLevelValue(yaml: string, key: string): string {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(yaml);
  if (!match) throw new Error(`Builder config key is missing: ${key}`);
  return match[1].trim();
}

function topLevelSection(yaml: string, key: string): string {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start < 0) throw new Error(`Builder config section is missing: ${key}`);
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    section.push(line);
  }
  return `${section.join("\n")}\n`;
}

function topLevelList(yaml: string, key: string): string[] {
  return topLevelSection(yaml, key)
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("- "))
    .map((line) => line.replace(/^\s*-\s+/, "").trim());
}

function targetMatrix(section: string): Record<string, string[]> {
  const targets: Record<string, string[]> = {};
  const targetPattern = /^\s{4}- target:\s+(.+)\r?\n\s{6}arch:\r?\n((?:\s{8}-\s+.+\r?\n)+)/gm;
  for (const match of section.matchAll(targetPattern)) {
    targets[match[1].trim()] = match[2].trim().split(/\r?\n/).map((line) => line.replace(/^\s*-\s+/, "").trim());
  }
  return targets;
}

describe("desktop release contract", () => {
  test("declares production Electron entrypoints and packaged resources", () => {
    const manifest = readPackageManifest();
    const config = readBuilderConfig();
    const directories = topLevelSection(config, "directories");

    expect(manifest.main).toBe("out/main/index.js");
    expect(topLevelValue(config, "appId")).toBe("ai.agentcompany.desktop");
    expect(topLevelValue(config, "productName")).toBe("AgentCompany");
    expect(topLevelValue(config, "asar")).toBe("true");
    expect(directories).toContain("output: release");
    expect(directories).toContain("buildResources: resources");
    // resources/icon.png ships inside the package so windows can load it at
    // runtime on Windows and Linux.
    expect(topLevelList(config, "files")).toEqual(["out/**/*", "package.json", "resources/icon.png"]);
    expect(existsSync(join(projectRoot, "resources", "icon.png"))).toBe(true);
    expect(existsSync(join(projectRoot, "resources", "icon.ico"))).toBe(true);
    expect(existsSync(join(projectRoot, "resources", "icon-mac.png"))).toBe(true);
    expect(existsSync(join(projectRoot, "resources", "entitlements.mac.plist"))).toBe(true);
  });

  test("locks the desktop target matrix required by the PRD", () => {
    const config = readBuilderConfig();

    expect(targetMatrix(topLevelSection(config, "win"))).toEqual({ nsis: ["x64"] });
    expect(targetMatrix(topLevelSection(config, "mac"))).toEqual({
      dmg: ["x64", "arm64"],
      zip: ["x64", "arm64"],
    });
    expect(targetMatrix(topLevelSection(config, "linux"))).toEqual({
      AppImage: ["x64"],
      deb: ["x64"],
    });
  });

  test("keeps package scripts aligned with configured desktop targets", () => {
    const { scripts } = readPackageManifest();

    expect(scripts["package:dir"]).toBe("pnpm build && electron-builder --dir --publish never");
    expect(scripts["package:win"]).toBe("pnpm build && electron-builder --win --x64 --publish never");
    expect(scripts["package:mac:arm"]).toBe("pnpm build && electron-builder --mac --arm64 --publish never");
    expect(scripts["package:mac:x64"]).toBe("pnpm build && electron-builder --mac --x64 --publish never");
    expect(scripts["package:mac"]).toBe("pnpm build && electron-builder --mac --x64 --arm64 --publish never");
    expect(scripts["package:linux"]).toBe("pnpm build && electron-builder --linux --x64 --publish never");
  });
});
