import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { zh } from "../../src/renderer/src/i18n/zh";

const RENDERER_ROOT = join(__dirname, "../../src/renderer/src");

function rendererSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...rendererSources(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe("i18n coverage", () => {
  const sources = rendererSources(RENDERER_ROOT);

  test("every t() key has a Chinese translation", () => {
    const missing = new Set<string>();
    for (const path of sources) {
      const src = readFileSync(path, "utf8");
      for (const match of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) {
        if (!(match[1] in zh)) missing.add(match[1]);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  test("t() keys are plain double-quoted literals", () => {
    const offenders: string[] = [];
    for (const path of sources) {
      if (path.includes("/i18n/") || path.includes("\\i18n\\")) continue;
      const src = readFileSync(path, "utf8");
      // The key must be the literal first argument — expressions (ternaries,
      // variables, other quotes) hide keys from extraction and translation.
      if (/\bt\(\s*(?!")/.test(src)) offenders.push(path.slice(RENDERER_ROOT.length + 1));
    }
    expect(offenders).toEqual([]);
  });

  test("translations keep their placeholders", () => {
    const broken: string[] = [];
    for (const [key, value] of Object.entries(zh)) {
      const wanted = [...key.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      const got = [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      if (wanted.join(",") !== got.join(",")) broken.push(key);
    }
    expect(broken).toEqual([]);
  });
});
