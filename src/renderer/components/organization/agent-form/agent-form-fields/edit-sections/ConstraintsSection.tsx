import type { AgentRecord } from "@shared/types";
import { Input, TextArea } from "../../../../ui";
import { BudgetBar } from "../../../helpers";
import { formatMoney } from "../../../../../lib/formatters";
import { useT } from "../../../../../i18n";
import type { AgentFormState } from "../../useAgentForm";
import { SectionHeader } from "./SectionHeader";

interface ConstraintsSectionProps {
  form: AgentFormState;
  agent: AgentRecord;
  pendingApproval: boolean;
}

/**
 * Budget + scope of work. Budget surfaces the live burn via BudgetBar so
 * the board can see whether a proposed change (typing a new budget in the
 * input) tracks reality. Capabilities gets a concrete placeholder so
 * agents ship with useful, specific scope statements instead of the
 * previous "What this agent does" circular prompt.
 */
export function ConstraintsSection({ form, agent, pendingApproval }: ConstraintsSectionProps) {
  const t = useT();
  const budgetValue = Number(form.budget || 0);
  const showBurn = budgetValue > 0 || agent.spentMonthlyUsd > 0;

  return (
    <SectionHeader title={t("agent.form.sectionConstraints")}>
      <Input
        label={t("agent.budget")}
        value={form.budget}
        onChange={form.setBudget}
        placeholder={t("agent.form.budgetPlaceholder")}
        type="number"
        readOnly={pendingApproval}
        disabled={pendingApproval}
      />
      {showBurn ? (
        <div className="grid gap-1.5">
          <BudgetBar spent={agent.spentMonthlyUsd} budget={budgetValue} />
          <p className="text-[11px] text-muted-foreground">
            {t("agent.form.budgetBurn")
              .replace("{spent}", formatMoney(agent.spentMonthlyUsd))
              .replace("{budget}", formatMoney(budgetValue))}
          </p>
        </div>
      ) : null}
      <TextArea
        label={t("agent.capabilities")}
        value={form.capabilities}
        onChange={form.setCapabilities}
        placeholder={t("agent.form.capabilitiesPlaceholder")}
        readOnly={pendingApproval}
        disabled={pendingApproval}
      />
    </SectionHeader>
  );
}
