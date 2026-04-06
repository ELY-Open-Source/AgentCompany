import type { DatabaseSync } from "node:sqlite";
import type { SkillRecord, FileInventoryEntry, SkillSourceType, TrustLevel } from "../skill-types.js";
import type { ReadAll, SqliteRow } from "./helpers";
import { nowIso, parseJson } from "./helpers";

export function buildSkillMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
) {
  function mapSkillRow(row: SqliteRow): SkillRecord {
    return {
      id: row.id,
      companyId: row.company_id,
      key: row.key,
      slug: row.slug,
      name: row.name,
      description: row.description ?? null,
      markdown: row.markdown ?? "",
      sourceType: (row.source_type ?? "local_path") as SkillSourceType,
      sourceLocator: row.source_locator ?? null,
      sourceRef: row.source_ref ?? null,
      trustLevel: (row.trust_level ?? "markdown_only") as TrustLevel,
      compatibility: row.compatibility ?? "compatible",
      fileInventory: parseJson<FileInventoryEntry[]>(row.file_inventory, []),
      metadata: parseJson<Record<string, unknown> | null>(row.metadata, null),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return {
    upsertCompanySkill(skill: {
      id: string; companyId: string; key: string; slug: string; name: string;
      description: string | null; markdown: string; sourceType: string;
      sourceLocator: string | null; sourceRef: string | null; trustLevel: string;
      compatibility: string; fileInventory: string; metadata: string | null;
      createdAt: string; updatedAt: string;
    }): { isUpdate: boolean } {
      const existing = getDb()
        .prepare("SELECT 1 FROM company_skills WHERE company_id = ? AND key = ?")
        .get(skill.companyId, skill.key);
      const isUpdate = existing != null;

      getDb().prepare(`
        INSERT INTO company_skills (
          id, company_id, key, slug, name, description, markdown,
          source_type, source_locator, source_ref, trust_level,
          compatibility, file_inventory, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(company_id, key) DO UPDATE SET
          slug = excluded.slug,
          name = excluded.name,
          description = excluded.description,
          markdown = excluded.markdown,
          source_ref = excluded.source_ref,
          trust_level = excluded.trust_level,
          file_inventory = excluded.file_inventory,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at
      `).run(
        skill.id, skill.companyId, skill.key, skill.slug,
        skill.name, skill.description, skill.markdown,
        skill.sourceType, skill.sourceLocator, skill.sourceRef,
        skill.trustLevel, skill.compatibility, skill.fileInventory,
        skill.metadata, skill.createdAt, skill.updatedAt,
      );

      return { isUpdate };
    },

    listCompanySkills(companyId: string): SkillRecord[] {
      const rows = readAll<SqliteRow>(
        "SELECT * FROM company_skills WHERE company_id = ? ORDER BY created_at ASC",
        companyId,
      );
      return rows.map((row) => mapSkillRow(row));
    },

    getCompanySkill(companyId: string, skillId: string): SkillRecord | null {
      const row = getDb()
        .prepare("SELECT * FROM company_skills WHERE id = ? AND company_id = ?")
        .get(skillId, companyId) as SqliteRow | undefined;
      return row ? mapSkillRow(row) : null;
    },

    deleteCompanySkill(companyId: string, skillId: string): boolean {
      const result = getDb()
        .prepare("DELETE FROM company_skills WHERE id = ? AND company_id = ?")
        .run(skillId, companyId);
      return result.changes > 0;
    },

    assignSkillToAgent(agentId: string, skillId: string): void {
      getDb()
        .prepare("INSERT OR IGNORE INTO agent_skill_assignments (agent_id, skill_id, created_at) VALUES (?, ?, ?)")
        .run(agentId, skillId, nowIso());
    },

    removeSkillFromAgent(agentId: string, skillId: string): void {
      getDb()
        .prepare("DELETE FROM agent_skill_assignments WHERE agent_id = ? AND skill_id = ?")
        .run(agentId, skillId);
    },

    listAgentSkillAssignments(agentId: string): string[] {
      return readAll<{ skill_id: string }>(
        "SELECT skill_id FROM agent_skill_assignments WHERE agent_id = ?",
        agentId,
      ).map((row) => row.skill_id);
    },

    listSkillAgentAssignments(skillId: string): string[] {
      return readAll<{ agent_id: string }>(
        "SELECT agent_id FROM agent_skill_assignments WHERE skill_id = ?",
        skillId,
      ).map((row) => row.agent_id);
    },

    updateCompanySkillMetadata(companyId: string, skillId: string, metadataJson: string): void {
      const ts = nowIso();
      getDb().prepare(
        "UPDATE company_skills SET metadata = ?, updated_at = ? WHERE id = ? AND company_id = ?"
      ).run(metadataJson, ts, skillId, companyId);
    },
  };
}
