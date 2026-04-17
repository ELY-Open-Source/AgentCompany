import sop001 from "./sops/sop-001-standup.md?raw";
import sop002 from "./sops/sop-002-task-lifecycle.md?raw";
import sop003 from "./sops/sop-003-delegation.md?raw";
import sop004 from "./sops/sop-004-code-review.md?raw";
import sop005 from "./sops/sop-005-hiring.md?raw";
import sop006 from "./sops/sop-006-escalation.md?raw";
import sop007 from "./sops/sop-007-communication.md?raw";
import sop008 from "./sops/sop-008-cross-department.md?raw";
import sop009 from "./sops/sop-009-documents.md?raw";
import sop010 from "./sops/sop-010-budget.md?raw";
import sop011 from "./sops/sop-011-quality.md?raw";
import sop012 from "./sops/sop-012-cadence.md?raw";
import sop013 from "./sops/sop-013-incident.md?raw";
import sop014 from "./sops/sop-014-hiring-pipeline.md?raw";
import sop015 from "./sops/sop-015-knowledge.md?raw";

export type SOPId =
  | "sop-001" | "sop-002" | "sop-003" | "sop-004" | "sop-005"
  | "sop-006" | "sop-007" | "sop-008" | "sop-009" | "sop-010"
  | "sop-011" | "sop-012" | "sop-013" | "sop-014" | "sop-015";

const SOPS: Record<SOPId, string> = {
  "sop-001": sop001,
  "sop-002": sop002,
  "sop-003": sop003,
  "sop-004": sop004,
  "sop-005": sop005,
  "sop-006": sop006,
  "sop-007": sop007,
  "sop-008": sop008,
  "sop-009": sop009,
  "sop-010": sop010,
  "sop-011": sop011,
  "sop-012": sop012,
  "sop-013": sop013,
  "sop-014": sop014,
  "sop-015": sop015,
};

export function getSOP(id: SOPId): string {
  return SOPS[id].trimEnd();
}

export function buildSOPSection(): string {
  const body = (Object.keys(SOPS) as SOPId[])
    .map((id) => SOPS[id].trimEnd())
    .join("\n\n");
  return `# Standard Operating Procedures\n\n${body}\n`;
}
