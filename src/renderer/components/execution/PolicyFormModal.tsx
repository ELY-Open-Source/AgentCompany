import { useEffect, useState } from "react";
import type { BudgetPolicyRecord } from "@shared/types";
import { ActionButton, Input, Modal, Select } from "../ui";
import { buildBudgetPolicyInput, getBudgetPolicyAmountDollars } from "../../lib/budget-policy-input";

interface PolicyFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  companyId: string;
  editingPolicy: BudgetPolicyRecord | null;
  agents: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
}

export function PolicyFormModal({ open, onClose, onSaved, companyId, editingPolicy, agents, projects }: PolicyFormModalProps) {
  const [scopeType, setScopeType] = useState<"company" | "agent" | "project">("company");
  const [scopeId, setScopeId] = useState(companyId);
  const [amountDollars, setAmountDollars] = useState("100");
  const [warnPercent, setWarnPercent] = useState("80");
  const [hardStopEnabled, setHardStopEnabled] = useState(true);
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingPolicy) {
      setScopeType(editingPolicy.scopeType);
      setScopeId(editingPolicy.scopeId);
      setAmountDollars(getBudgetPolicyAmountDollars(editingPolicy));
      setWarnPercent(String(editingPolicy.warnPercent));
      setHardStopEnabled(editingPolicy.hardStopEnabled);
      setNotifyEnabled(editingPolicy.notifyEnabled);
    } else {
      setScopeType("company");
      setScopeId(companyId);
      setAmountDollars("100");
      setWarnPercent("80");
      setHardStopEnabled(true);
      setNotifyEnabled(true);
    }
  }, [editingPolicy, companyId]);

  useEffect(() => {
    if (scopeType === "company") {
      setScopeId(companyId);
    } else if (scopeType === "agent" && agents.length > 0) {
      setScopeId(agents[0].id);
    } else if (scopeType === "project" && projects.length > 0) {
      setScopeId(projects[0].id);
    }
  }, [scopeType, companyId, agents, projects]);

  async function handleSave() {
    setSaving(true);
    try {
      const payload = buildBudgetPolicyInput({
        policyId: editingPolicy?.id ?? null,
        companyId,
        scopeType,
        scopeId,
        amountDollars,
        warnPercent,
        hardStopEnabled,
        notifyEnabled,
      });
      if (!payload) return;

      const result = await window.agentCompany.saveBudgetPolicy(payload);
      if (result.ok) {
        onSaved();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingPolicy ? "Edit Budget Policy" : "Add Budget Policy"}
    >
      <div className="grid gap-4">
        <Select
          label="Scope"
          value={scopeType}
          onChange={(v) => setScopeType(v as "company" | "agent" | "project")}
          options={[
            { value: "company", label: "Company" },
            { value: "agent", label: "Agent" },
            { value: "project", label: "Project" },
          ]}
        />

        {scopeType === "agent" ? (
          <Select
            label="Agent"
            value={scopeId}
            onChange={setScopeId}
            options={agents.map((a) => ({ value: a.id, label: a.name }))}
          />
        ) : null}

        {scopeType === "project" ? (
          <Select
            label="Project"
            value={scopeId}
            onChange={setScopeId}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
        ) : null}

        <Input
          label="Monthly Budget (USD)"
          value={amountDollars}
          onChange={setAmountDollars}
          type="number"
          placeholder="100.00"
        />

        <Input
          label="Warning Threshold (%)"
          value={warnPercent}
          onChange={setWarnPercent}
          type="number"
          placeholder="80"
        />

        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={hardStopEnabled}
            onChange={(e) => setHardStopEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-[color:var(--primary)]"
          />
          <span className="text-[13px] text-foreground">Enable hard stop (block new runs at 100%)</span>
        </label>

        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={notifyEnabled}
            onChange={(e) => setNotifyEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-[color:var(--primary)]"
          />
          <span className="text-[13px] text-foreground">Send notifications</span>
        </label>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            className="rounded-lg px-4 py-2 text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
            onClick={onClose}
          >
            Cancel
          </button>
          <ActionButton
            label={saving ? "Saving..." : "Save Policy"}
            tone="accent"
            disabled={saving}
            onClick={() => void handleSave()}
          />
        </div>
      </div>
    </Modal>
  );
}
