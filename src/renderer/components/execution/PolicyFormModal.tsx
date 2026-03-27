import { useEffect, useState } from "react";
import type { BudgetPolicyRecord } from "@shared/types";
import { ActionButton, Input, Modal, Select } from "../ui";

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
      setAmountDollars((editingPolicy.amount / 100).toFixed(2));
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
      const amountCents = Math.round(parseFloat(amountDollars) * 100);
      if (Number.isNaN(amountCents) || amountCents <= 0) return;

      const wp = parseInt(warnPercent, 10);
      if (Number.isNaN(wp) || wp < 1 || wp > 100) return;

      const result = await window.agentCompany.saveBudgetPolicy({
        companyId,
        scopeType,
        scopeId,
        metric: "billed_cents",
        windowKind: "calendar_month_utc",
        amount: amountCents,
        warnPercent: wp,
        hardStopEnabled,
        notifyEnabled,
        isActive: true,
      });
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
            className="h-4 w-4 rounded border-[color:var(--line)] accent-[color:var(--accent)]"
          />
          <span className="text-[13px] text-[color:var(--text)]">Enable hard stop (block new runs at 100%)</span>
        </label>

        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={notifyEnabled}
            onChange={(e) => setNotifyEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-[color:var(--line)] accent-[color:var(--accent)]"
          />
          <span className="text-[13px] text-[color:var(--text)]">Send notifications</span>
        </label>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            className="rounded-[8px] px-4 py-2 text-[13px] font-medium text-[color:var(--muted-strong)] transition hover:text-[color:var(--text)]"
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
