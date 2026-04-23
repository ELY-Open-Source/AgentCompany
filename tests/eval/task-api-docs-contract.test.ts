import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TASK_API_DOC = join(__dirname, "../../src/main/prompt-builder/api-docs/tasks.en.md");

describe("task API prompt contract", () => {
  it("documents requiresFilesystem for code and workspace task creation", async () => {
    const doc = await readFile(TASK_API_DOC, "utf8");

    expect(doc).toContain('"requiresFilesystem": true');
    expect(doc).toContain("Set requiresFilesystem=true for code, file, repository, build, test, or local workspace work.");
    expect(doc).toMatch(/Implement user auth[\s\S]*"requiresFilesystem":true/);
  });
});
