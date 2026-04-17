import { DEPARTMENT_OPTIONS } from "@shared/constants";
import type { AgentRecord, DepartmentId } from "@shared/types";
import { Input, Select } from "../../../../ui";
import { useT } from "../../../../../i18n";
import type { AgentFormState } from "../../useAgentForm";
import { SectionHeader } from "./SectionHeader";

interface IdentitySectionProps {
  form: AgentFormState;
  agent: AgentRecord;
  agents: AgentRecord[];
  pendingApproval: boolean;
}

/**
 * Who this agent is and where they sit in the org: Name / Role / Title /
 * Department / Reports To. "Assignments" (Reports To) lives here because it
 * answers the same question identity fields do — who is this person — and
 * keeping it with Name/Role lets the user fill the whole identity picture
 * in one pass before moving to runtime config.
 */
export function IdentitySection({ form, agent, agents, pendingApproval }: IdentitySectionProps) {
  const t = useT();
  const managerCandidates = agents.filter((a) => a.id !== agent.id);

  return (
    <SectionHeader title={t("agent.form.sectionIdentity")}>
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
      <Input
        label={t("agent.title")}
        value={form.title}
        onChange={form.setTitle}
        placeholder={t("agent.title")}
        readOnly={pendingApproval}
        disabled={pendingApproval}
      />
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
    </SectionHeader>
  );
}
