import { useState, type FormEvent } from "react";
import type { AgentRecord, EmployeeRecord } from "../../../../shared/domain";
import { Dialog } from "../../shared/Dialog";
import { Field } from "../../shared/ui";
import { t } from "../../i18n/i18n";

export type SpaceType = "company" | "division" | "department" | "project" | "pod" | "ad_hoc" | "direct";
export type Visibility = "workspace" | "restricted";

const hint = { fontSize: "var(--fs-body)", color: "var(--text-3)", margin: 0, lineHeight: 1.5 } as const;

/** Each choice says what it changes: who is a member, who can read it, and which agents a message wakes. */
export function NewSpaceDialog({ open, employee, employees, agents, onClose, onSubmit }: {
  open: boolean;
  employee: EmployeeRecord;
  employees: EmployeeRecord[];
  agents: AgentRecord[];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [spaceType, setSpaceType] = useState<SpaceType>("project");
  const [visibility, setVisibility] = useState<Visibility>("workspace");
  const direct = spaceType === "direct";
  // A workspace channel takes in everyone, so picking members would change nothing.
  const everyone = !direct && visibility === "workspace";
  return (
    <Dialog title={t("New space")} open={open} submitLabel={t("Create")} onClose={onClose} onSubmit={onSubmit}>
      <Field label={t("Name")}><input className="input" name="name" required /></Field>
      <Field label={t("Topic")}><input className="input" name="topic" required /></Field>
      <Field label={t("Type")}>
        <select className="input" name="spaceType" value={spaceType} onChange={(event) => setSpaceType(event.target.value as SpaceType)}>
          <option value="company">{t("Company")}</option>
          <option value="division">{t("Division")}</option>
          <option value="department">{t("Department")}</option>
          <option value="project">{t("Project")}</option>
          <option value="pod">{t("Pod")}</option>
          <option value="ad_hoc">{t("Ad-hoc")}</option>
          <option value="direct">{t("Direct")}</option>
        </select>
      </Field>
      <p style={hint} role="note">
        {direct
          ? t("Direct: only its members take part, and every message wakes the other members. As the board, you can read it even when you are not a member.")
          : t("Company, division, department, project, pod and ad-hoc are labels for finding the conversation; they behave the same. An agent replies when @mentioned or already in the thread; a message that names no one goes to the most senior agent member.")}
      </p>
      {direct ? (
        <input type="hidden" name="visibility" value="restricted" />
      ) : (
        <>
          <Field label={t("Visibility")}>
            <select className="input" name="visibility" value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)}>
              <option value="workspace">{t("Workspace")}</option>
              <option value="restricted">{t("Restricted")}</option>
            </select>
          </Field>
          <p style={hint} role="note">
            {everyone
              ? t("Workspace: everyone in the company is a member, including agents hired later, and any agent can read it.")
              : t("Restricted: only the members you pick take part; agents outside it cannot read it. As the board, you can read it even when you are not a member.")}
          </p>
        </>
      )}
      {!everyone && (
        <>
          <Field label={t("Employees")}>
            <select className="input" name="memberEmployeeIds" multiple size={Math.max(1, Math.min(4, employees.length))}>
              {employees.filter((item) => item.id !== employee.id).map((item) => (
                <option key={item.id} value={item.id}>{item.displayName}</option>
              ))}
            </select>
          </Field>
          <Field label={t("Agents")}>
            <select className="input" name="memberAgentIds" multiple size={Math.max(1, Math.min(4, agents.length))}>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </Field>
        </>
      )}
    </Dialog>
  );
}
