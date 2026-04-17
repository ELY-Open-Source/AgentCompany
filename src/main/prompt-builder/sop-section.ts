import type { AppLocale } from "@shared/locale";
import { resolveLocale } from "./messages/locale";

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

import sop001Zh from "./sops/sop-001-standup.zh.md?raw";
import sop002Zh from "./sops/sop-002-task-lifecycle.zh.md?raw";
import sop003Zh from "./sops/sop-003-delegation.zh.md?raw";
import sop004Zh from "./sops/sop-004-code-review.zh.md?raw";
import sop005Zh from "./sops/sop-005-hiring.zh.md?raw";
import sop006Zh from "./sops/sop-006-escalation.zh.md?raw";
import sop007Zh from "./sops/sop-007-communication.zh.md?raw";
import sop008Zh from "./sops/sop-008-cross-department.zh.md?raw";
import sop009Zh from "./sops/sop-009-documents.zh.md?raw";
import sop010Zh from "./sops/sop-010-budget.zh.md?raw";
import sop011Zh from "./sops/sop-011-quality.zh.md?raw";
import sop012Zh from "./sops/sop-012-cadence.zh.md?raw";
import sop013Zh from "./sops/sop-013-incident.zh.md?raw";
import sop014Zh from "./sops/sop-014-hiring-pipeline.zh.md?raw";
import sop015Zh from "./sops/sop-015-knowledge.zh.md?raw";

export type SOPId =
  | "sop-001" | "sop-002" | "sop-003" | "sop-004" | "sop-005"
  | "sop-006" | "sop-007" | "sop-008" | "sop-009" | "sop-010"
  | "sop-011" | "sop-012" | "sop-013" | "sop-014" | "sop-015";

const SOPS: Record<AppLocale, Record<SOPId, string>> = {
  en: {
    "sop-001": sop001En, "sop-002": sop002En, "sop-003": sop003En,
    "sop-004": sop004En, "sop-005": sop005En, "sop-006": sop006En,
    "sop-007": sop007En, "sop-008": sop008En, "sop-009": sop009En,
    "sop-010": sop010En, "sop-011": sop011En, "sop-012": sop012En,
    "sop-013": sop013En, "sop-014": sop014En, "sop-015": sop015En,
  },
  zh: {
    "sop-001": sop001Zh, "sop-002": sop002Zh, "sop-003": sop003Zh,
    "sop-004": sop004Zh, "sop-005": sop005Zh, "sop-006": sop006Zh,
    "sop-007": sop007Zh, "sop-008": sop008Zh, "sop-009": sop009Zh,
    "sop-010": sop010Zh, "sop-011": sop011Zh, "sop-012": sop012Zh,
    "sop-013": sop013Zh, "sop-014": sop014Zh, "sop-015": sop015Zh,
  },
};

const SOP_HEADING: Record<AppLocale, string> = {
  en: "# Standard Operating Procedures",
  zh: "# 标准操作流程（SOP）",
};

const SOP_IDS: SOPId[] = [
  "sop-001", "sop-002", "sop-003", "sop-004", "sop-005",
  "sop-006", "sop-007", "sop-008", "sop-009", "sop-010",
  "sop-011", "sop-012", "sop-013", "sop-014", "sop-015",
];

export function getSOP(id: SOPId, locale?: AppLocale): string {
  return SOPS[resolveLocale(locale)][id].trimEnd();
}

export function buildSOPSection(locale?: AppLocale): string {
  const lang = resolveLocale(locale);
  const body = SOP_IDS.map((id) => SOPS[lang][id].trimEnd()).join("\n\n");
  return `${SOP_HEADING[lang]}\n\n${body}\n`;
}
