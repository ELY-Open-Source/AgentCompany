import sop001En from "./sops/sop-001-standup.en.md?raw";
import sop002En from "./sops/sop-002-task-lifecycle.en.md?raw";
import sop003En from "./sops/sop-003-delegation.en.md?raw";
import sop004En from "./sops/sop-004-code-review.en.md?raw";
import sop005En from "./sops/sop-005-hiring.en.md?raw";
import sop006En from "./sops/sop-006-escalation.en.md?raw";
import sop007En from "./sops/sop-007-communication.en.md?raw";
import sop008En from "./sops/sop-008-cross-department.en.md?raw";
import sop009En from "./sops/sop-009-documents.en.md?raw";
import sop010En from "./sops/sop-010-budget.en.md?raw";
import sop011En from "./sops/sop-011-quality.en.md?raw";
import sop012En from "./sops/sop-012-cadence.en.md?raw";
import sop013En from "./sops/sop-013-incident.en.md?raw";
import sop014En from "./sops/sop-014-hiring-pipeline.en.md?raw";
import sop015En from "./sops/sop-015-knowledge.en.md?raw";

export type SOPId =
  | "sop-001" | "sop-002" | "sop-003" | "sop-004" | "sop-005"
  | "sop-006" | "sop-007" | "sop-008" | "sop-009" | "sop-010"
  | "sop-011" | "sop-012" | "sop-013" | "sop-014" | "sop-015";

const SOPS: Record<SOPId, string> = {
  "sop-001": sop001En, "sop-002": sop002En, "sop-003": sop003En,
  "sop-004": sop004En, "sop-005": sop005En, "sop-006": sop006En,
  "sop-007": sop007En, "sop-008": sop008En, "sop-009": sop009En,
  "sop-010": sop010En, "sop-011": sop011En, "sop-012": sop012En,
  "sop-013": sop013En, "sop-014": sop014En, "sop-015": sop015En,
};

const SOP_HEADING = "# Standard Operating Procedures";

const SOP_IDS: SOPId[] = [
  "sop-001", "sop-002", "sop-003", "sop-004", "sop-005",
  "sop-006", "sop-007", "sop-008", "sop-009", "sop-010",
  "sop-011", "sop-012", "sop-013", "sop-014", "sop-015",
];

export function getSOP(id: SOPId): string {
  return SOPS[id].trimEnd();
}

export function buildSOPSection(): string {
  const body = SOP_IDS.map((id) => SOPS[id].trimEnd()).join("\n\n");
  return `${SOP_HEADING}\n\n${body}\n`;
}
