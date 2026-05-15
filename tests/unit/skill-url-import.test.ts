import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "@main/database";
import { MAX_SKILL_BYTES } from "@main/skill-github";
import { importFromUrl } from "@main/skills/import-url";

const encoder = new TextEncoder();

function responseFromChunks(chunks: string[], onCancel: () => void): Response {
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    body: {
      getReader() {
        return {
          async read() {
            const chunk = chunks[index];
            index += 1;
            if (chunk === undefined) {
              return { done: true, value: undefined };
            }
            return { done: false, value: encoder.encode(chunk) };
          },
          async cancel() {
            onCancel();
          },
        };
      },
    },
    async text() {
      throw new Error("streaming URL imports should not call response.text()");
    },
  } as unknown as Response;
}

describe("skill URL import", () => {
  let tempDir: string;
  let db: AppDatabase;
  let companyId: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-skill-url-import-"));
    db = new AppDatabase(tempDir);
    db.init();
    companyId = db.core.company.saveCompany({
      name: "Skill Import Test",
      description: "URL import limit coverage",
      status: "active",
    });
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects URL imports before materializing oversized responses", async () => {
    const safeFetch = vi.fn(async () => new Response("---\nname: Large\n---\n", {
      headers: { "Content-Length": String(MAX_SKILL_BYTES + 1) },
    }));

    await expect(importFromUrl({
      db,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      skillFilesDir: (ownerCompanyId, slug) => join(tempDir, "skills", ownerCompanyId, slug),
    }, companyId, "https://example.com/skills/large.md", safeFetch)).rejects.toThrow(
      `Response too large: ${MAX_SKILL_BYTES + 1} bytes (max ${MAX_SKILL_BYTES})`,
    );

    expect(safeFetch).toHaveBeenCalledWith("https://example.com/skills/large.md");
    expect(db.core.skills.listCompanySkills(companyId)).toEqual([]);
  });

  it("cancels chunked URL import reads that exceed the skill byte limit", async () => {
    let cancelled = false;
    const skillDir = join(tempDir, "skills", companyId, "large");
    const header = "---\nname: Large\nslug: large\n---\n";
    const firstChunk = "a".repeat(MAX_SKILL_BYTES - encoder.encode(header).byteLength);
    const safeFetch = vi.fn(async () => responseFromChunks([header, firstChunk, "b"], () => {
      cancelled = true;
    }));

    await expect(importFromUrl({
      db,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      skillFilesDir: (ownerCompanyId, slug) => join(tempDir, "skills", ownerCompanyId, slug),
    }, companyId, "https://example.com/skills/large.md", safeFetch)).rejects.toThrow(
      `Response body exceeded ${MAX_SKILL_BYTES} bytes`,
    );

    expect(cancelled).toBe(true);
    expect(existsSync(skillDir)).toBe(false);
    expect(db.core.skills.listCompanySkills(companyId)).toEqual([]);
  });
});
