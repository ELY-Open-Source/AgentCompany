import { useMemo, useState } from "react";
import { FloppyDisk, NotePencil, Rows, Trash } from "@phosphor-icons/react";
import type { SprintRecord } from "@shared/types";
import { ActionButton, ConfirmDialog, InlineNotice, Input, ListFrame, ListRow, Modal, Select, StatusPill, TextArea } from "../ui";
import { useT } from "../../i18n";
import { sprintStatusOptions } from "./helpers";
import { SectionHeader } from "./SectionHeader";

function SprintEditor({ companyId, sprint, onSaved }: {
  companyId: string; sprint: SprintRecord | null; onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(sprint?.name ?? "");
  const [goal, setGoal] = useState(sprint?.goal ?? "");
  const [startDate, setStartDate] = useState(sprint?.startDate ?? new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(sprint?.endDate ?? new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
  const [status, setStatus] = useState(sprint?.status ?? "planning");
  const [velocityPoints, setVelocityPoints] = useState(String(sprint?.velocityPoints ?? 20));
  const [completedPoints, setCompletedPoints] = useState(String(sprint?.completedPoints ?? 0));
  const [retrospectiveNotes, setRetrospectiveNotes] = useState(sprint?.retrospectiveNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) { setError("Sprint name is required."); return; }
    setSaving(true); setError(null);
    try {
      const result = await window.agentCompany.saveSprint({
        id: sprint?.id ?? null, companyId, name: name.trim(), goal: goal.trim(),
        startDate, endDate,
        status: status as Parameters<typeof window.agentCompany.saveSprint>[0]["status"],
        retrospectiveNotes,
        velocityPoints: Number.parseInt(velocityPoints, 10) || 0,
        completedPoints: Number.parseInt(completedPoints, 10) || 0,
      });
      if (!result.ok) { setError(result.error.message); return; }
      await onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      {error ? <InlineNotice message={error} /> : null}
      <Input label="Sprint name" value={name} onChange={setName} placeholder="Sprint 12" />
      <TextArea label="Goal" value={goal} onChange={setGoal} rows={3} placeholder="What this sprint is meant to achieve." />
      <div className="grid gap-4 md:grid-cols-2">
        <Input label="Start date" value={startDate} onChange={setStartDate} type="date" />
        <Input label="End date" value={endDate} onChange={setEndDate} type="date" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Select label="Status" value={status} onChange={(value) => setStatus(value as typeof status)} options={sprintStatusOptions} />
        <Input label="Velocity points" value={velocityPoints} onChange={setVelocityPoints} type="number" />
        <Input label="Completed points" value={completedPoints} onChange={setCompletedPoints} type="number" />
      </div>
      <TextArea label="Retrospective notes" value={retrospectiveNotes} onChange={setRetrospectiveNotes} rows={5} placeholder="What should the team retain, change, or stop?" />
      <div className="flex justify-end">
        <ActionButton label={saving ? "Saving..." : sprint ? "Save sprint" : "Create sprint"} icon={FloppyDisk} tone="accent" onClick={() => void save()} loading={saving} />
      </div>
    </div>
  );
}

export function SprintManager({ companyId, sprints, onRefresh }: {
  companyId: string; sprints: SprintRecord[]; onRefresh: () => Promise<void>;
}) {
  const t = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const activeSprint = useMemo(() => sprints.find((sprint) => sprint.id === editingId) ?? null, [sprints, editingId]);

  return (
    <div>
      <SectionHeader title={t("ops.sprintBoard")} count={sprints.length} action={() => setEditingId("__new__")} />
      <ListFrame>
        {sprints.map((sprint) => (
          <ListRow key={sprint.id}>
            <div className="flex items-start justify-between gap-3">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditingId(sprint.id)}>
                <div className="flex items-center gap-2 text-[13px] font-medium text-[color:var(--text)]">
                  <Rows size={15} className="text-[color:var(--accent)]" />
                  <span className="truncate">{sprint.name}</span>
                </div>
                <div className="mt-1 text-[11px] text-[color:var(--muted)]">{sprint.startDate} → {sprint.endDate} · {sprint.completedPoints}/{sprint.velocityPoints} pts</div>
              </button>
              <div className="flex items-center gap-2">
                <StatusPill status={sprint.status} />
                <button type="button" className="rounded p-1 text-[color:var(--muted)] hover:text-[color:var(--text)]" onClick={() => setEditingId(sprint.id)}><NotePencil size={14} /></button>
                <button type="button" className="rounded p-1 text-[color:var(--muted)] hover:text-[color:var(--danger)]" onClick={() => setDeleteId(sprint.id)}><Trash size={14} /></button>
              </div>
            </div>
          </ListRow>
        ))}
      </ListFrame>
      <Modal open={editingId !== null} title={activeSprint ? activeSprint.name : "New sprint"} onClose={() => setEditingId(null)} width="720px">
        <SprintEditor companyId={companyId} sprint={editingId === "__new__" ? null : activeSprint} onSaved={async () => { setEditingId(null); await onRefresh(); }} />
      </Modal>
      <ConfirmDialog open={deleteId !== null} title="Delete sprint" message="This removes the sprint board entry. Historical run and task records remain." onCancel={() => setDeleteId(null)} onConfirm={async () => { if (!deleteId) return; const result = await window.agentCompany.deleteSprint({ id: deleteId, companyId }); setDeleteId(null); if (result.ok) await onRefresh(); }} />
    </div>
  );
}
