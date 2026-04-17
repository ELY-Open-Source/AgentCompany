import type { AppLocale } from "@shared/locale";
import type { PromptContext } from "./index";
import { buildCEOInstructions } from "./operating-instructions-ceo";
import { getOperatingMessages, resolveLocale } from "./messages";

import engineeringEn from "./department-guidelines/engineering.en.md?raw";
import financeEn from "./department-guidelines/finance.en.md?raw";
import hrEn from "./department-guidelines/hr.en.md?raw";
import marketingEn from "./department-guidelines/marketing.en.md?raw";
import salesEn from "./department-guidelines/sales.en.md?raw";
import customerSupportEn from "./department-guidelines/customer_support.en.md?raw";
import operationsEn from "./department-guidelines/operations.en.md?raw";

import engineeringZh from "./department-guidelines/engineering.zh.md?raw";
import financeZh from "./department-guidelines/finance.zh.md?raw";
import hrZh from "./department-guidelines/hr.zh.md?raw";
import marketingZh from "./department-guidelines/marketing.zh.md?raw";
import salesZh from "./department-guidelines/sales.zh.md?raw";
import customerSupportZh from "./department-guidelines/customer_support.zh.md?raw";
import operationsZh from "./department-guidelines/operations.zh.md?raw";

export function buildOperatingInstructions(ctx: PromptContext, isCEO: boolean, isManager: boolean): string {
  const m = getOperatingMessages(ctx.locale);
  const parts: string[] = [];

  if (isCEO && ctx.allAgents.length > 1) {
    const lines = ctx.allAgents
      .filter((a) => a.id !== ctx.agent.id && a.status !== "terminated")
      .map((a) => {
        const manager = ctx.allAgents.find((mgr) => mgr.id === a.reportsTo);
        return m.rosterLine(a.name, a.role, a.title, manager?.name ?? m.rosterReportsToYou, a.status);
      });
    parts.push(`${m.fullCompanyRosterHeading}\n${lines.join("\n")}\n`);
  }

  if (isCEO) {
    parts.push(...buildCEOInstructions(ctx));
  } else if (isManager) {
    parts.push(...m.managerInstructions(ctx.agent.companyId));
  } else {
    parts.push(...m.icInstructions(ctx.agent.companyId, ctx.agent.id));
  }

  parts.push(m.companyCulture);
  parts.push(m.timeContext);

  return parts.join("\n");
}

export function buildDecisionAuthoritySection(ctx: PromptContext, isCEO: boolean, isManager: boolean): string {
  const m = getOperatingMessages(ctx.locale);
  const level = isCEO ? "executive" : isManager ? "manager" : "individual_contributor";
  const budgetDisplay = ctx.agent.budgetMonthlyUsd > 0
    ? m.budgetMonthly(ctx.agent.budgetMonthlyUsd, ctx.agent.spentMonthlyUsd)
    : m.noBudgetAllocated;
  return m.decisionAuthoritySection(level, budgetDisplay);
}

const DEPARTMENT_GUIDELINES: Record<AppLocale, Record<string, string>> = {
  en: {
    engineering: engineeringEn,
    finance: financeEn,
    hr: hrEn,
    marketing: marketingEn,
    sales: salesEn,
    customer_support: customerSupportEn,
    operations: operationsEn,
  },
  zh: {
    engineering: engineeringZh,
    finance: financeZh,
    hr: hrZh,
    marketing: marketingZh,
    sales: salesZh,
    customer_support: customerSupportZh,
    operations: operationsZh,
  },
};

export function buildDepartmentSection(ctx: PromptContext): string {
  const dept = ctx.agent.department;
  if (!dept) return "";
  const template = DEPARTMENT_GUIDELINES[resolveLocale(ctx.locale)][dept];
  if (!template) return "";
  return template.replace(/\{\{companyId\}\}/g, ctx.agent.companyId);
}
