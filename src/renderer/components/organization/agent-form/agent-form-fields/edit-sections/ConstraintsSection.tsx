import type { AgentRecord } from "@shared/types";
import { Input, TextArea } from "../../../../ui";
import { BudgetBar } from "../../../helpers";
import { formatMoney } from "../../../../../lib/formatters";
import { useT } from "../../../../../i18n";
import type { AgentFormState } from "../../useAgentForm";

interface ConstraintsSectionProps {
  form: AgentFormState;
  agent: AgentRecord;
  pendingApproval: boolean;
}

/**
 * Budget + scope of work. Live burn bar + spent/budget line appear
 * together under the input so typing a new cap updates the visual
 * context immediately. Capabilities gets a concrete placeholder so
 * agents ship with specific scope statements.
 */
export function ConstraintsSection({ form, agent, pendingApproval }: ConstraintsSectionProps) {
  const t = useT();
  const budgetValue = Number(form.budget || 0);
  const showBurn = budgetValue > 0 || agent.spentMonthlyUsd > 0;

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
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
          <>
            <BudgetBar spent={agent.spentMonthlyUsd} budget={budgetValue} />
            <p className="text-[11px] text-muted-foreground">
              {t("agent.form.budgetBurn")
                .replace("{spent}", formatMoney(agent.spentMonthlyUsd))
                .replace("{budget}", formatMoney(budgetValue))}
            </p>
          </>
        ) : null}
      </div>
      <TextArea
        label={t("agent.capabilities")}
        value={form.capabilities}
        onChange={form.setCapabilities}
        placeholder={t("agent.form.capabilitiesPlaceholder")}
        readOnly={pendingApproval}
        disabled={pendingApproval}
      />
    </div>
  );
}
