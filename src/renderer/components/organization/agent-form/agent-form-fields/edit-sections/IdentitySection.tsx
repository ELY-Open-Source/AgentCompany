import { DEPARTMENT_OPTIONS } from "@shared/constants";
import type { AgentRecord, DepartmentId } from "@shared/types";
import { Input, Select } from "../../../../ui";
import { useT } from "../../../../../i18n";
import type { AgentFormState } from "../../useAgentForm";

interface IdentitySectionProps {
  form: AgentFormState;
  agent: AgentRecord;
  agents: AgentRecord[];
  pendingApproval: boolean;
}

/**
 * Who this agent is and where they sit in the org. Rendered as the body
 * of the Identity tab inside the Edit modal — no section header, the tab
 * label carries that context. Short identity fields are paired on wider
 * viewports via the 2-column grid so the modal does not grow tall just
 * to fit Name + Role side by side.
 */
export function IdentitySection({ form, agent, agents, pendingApproval }: IdentitySectionProps) {
  const t = useT();
  const managerCandidates = agents.filter((a) => a.id !== agent.id);

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label={t("agent.name")}
          value={form.name}
          onChange={form.setName}
          placeholder={t("agent.name")}
          readOnly={pendingApproval}
          disabled={pendingApproval}
        />
        <Input
          label={t("agent.role")}
          value={form.role}
          onChange={form.setRole}
          placeholder={t("agent.role")}
          readOnly={pendingApproval}
          disabled={pendingApproval}
        />
      </div>
      <Input
        label={t("agent.title")}
        value={form.title}
        onChange={form.setTitle}
        placeholder={t("agent.title")}
        readOnly={pendingApproval}
        disabled={pendingApproval}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label={t("comm.department")}
          value={form.department}
          onChange={(value) => form.setDepartment(value as DepartmentId | "")}
          disabled={pendingApproval}
          options={DEPARTMENT_OPTIONS.map((option) => ({
            value: option.value,
            label: option.value === "" ? t("comm.selectDepartment") : option.label,
          }))}
        />
        <Select
          label={t("agent.reportsTo")}
          value={form.reportsTo}
          onChange={form.setReportsTo}
          disabled={pendingApproval}
          options={[
            { value: "", label: t("agent.noManager") },
            ...managerCandidates.map((a) => ({ value: a.id, label: a.name })),
          ]}
        />
      </div>
    </div>
  );
}
