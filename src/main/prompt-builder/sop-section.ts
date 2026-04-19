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

const SOPS_IN_ORDER: string[] = [
  sop001En, sop002En, sop003En, sop004En, sop005En,
  sop006En, sop007En, sop008En, sop009En, sop010En,
  sop011En, sop012En, sop013En, sop014En, sop015En,
];

const SOP_HEADING = "# Standard Operating Procedures";

export function buildSOPSection(): string {
  const body = SOPS_IN_ORDER.map((text) => text.trimEnd()).join("\n\n");
  return `${SOP_HEADING}\n\n${body}\n`;
}
