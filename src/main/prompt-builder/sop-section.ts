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

/**
 * Role-scoped SOP bundles.
 *
 * The system prompt previously concatenated all 15 SOPs for every agent
 * regardless of role. Individual contributors were receiving the hiring
 * pipeline, cadence, and budget SOPs they had no authority to act on;
 * every wake paid the token bill. The prompt-cache prefix also grew
 * with each SOP added over the life of the product.
 *
 * Each role receives the procedures it can execute under its decision
 * authority (see `operating-en.ts#authorityRules`). SOPs that every
 * agent must know regardless of seat — standup, communication,
 * incident response, knowledge contribution — appear in every bundle.
 */

const SOP_BY_ROLE = {
  executive: [
    sop001En, // standup
    sop003En, // delegation
    sop004En, // code-review (CEO still reviews top-level deliverables)
    sop005En, // hiring
    sop006En, // escalation
    sop007En, // communication
    sop008En, // cross-department
    sop009En, // documents
    sop010En, // budget
    sop012En, // cadence
    sop013En, // incident
    sop014En, // hiring-pipeline
    sop015En, // knowledge
  ],
  manager: [
    sop001En, // standup
    sop002En, // task-lifecycle
    sop003En, // delegation
    sop004En, // code-review
    sop006En, // escalation
    sop007En, // communication
    sop008En, // cross-department
    sop009En, // documents
    sop011En, // quality
    sop013En, // incident
    sop015En, // knowledge
  ],
  individual_contributor: [
    sop001En, // standup
    sop002En, // task-lifecycle
    sop004En, // code-review
    sop006En, // escalation
    sop007En, // communication
    sop009En, // documents
    sop011En, // quality
    sop015En, // knowledge
  ],
} as const;

export type SopAudience = keyof typeof SOP_BY_ROLE;

const SOP_HEADING = "# Standard Operating Procedures";

export function buildSOPSection(audience: SopAudience): string {
  const body = SOP_BY_ROLE[audience].map((text) => text.trimEnd()).join("\n\n");
  return `${SOP_HEADING}\n\n${body}\n`;
}
