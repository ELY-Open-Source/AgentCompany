import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/main/database";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("knowledge provenance", () => {
  it("preserves or refreshes sourceRunId when an existing knowledge entry is updated", async () => {
    const profileDir = await createTempDir("agentcompany-knowledge-provenance-");
    const db = new AppDatabase(profileDir);
    db.init();

    const companyId = db.core.company.saveCompany({
      name: "Knowledge Provenance Co",
      description: "Tests sourceRunId updates on knowledge entry edits",
      status: "active",
    });

    const knowledgeId = db.core.knowledge.saveKnowledgeEntry({
      companyId,
      category: "lesson_learned",
      topic: "Original lesson",
      content: "Initial content",
      importance: "medium",
      sourceRunId: null,
    });

    db.core.knowledge.saveKnowledgeEntry({
      id: knowledgeId,
      companyId,
      category: "lesson_learned",
      topic: "Original lesson",
      content: "Updated content with better guidance",
      importance: "high",
      sourceRunId: "run-123",
    });

    const entry = db.queryAll<{ sourceRunId: string | null; importance: string }>(
      "select source_run_id as sourceRunId, importance from knowledge_base where id = ? limit 1",
      knowledgeId,
    )[0];
    expect(entry?.sourceRunId).toBe("run-123");
    expect(entry?.importance).toBe("high");

    db.close();
  });
});
