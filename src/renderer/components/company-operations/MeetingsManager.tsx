import { useMemo, useState } from "react";
import { CalendarBlank, FloppyDisk, NotePencil, Trash } from "@phosphor-icons/react";
import type { AgentRecord, MeetingRecord } from "@shared/types";
import { ActionButton, ConfirmDialog, InlineNotice, Input, ListFrame, ListRow, Modal, Select, StatusPill } from "../ui";
import { useT } from "../../i18n";
import { meetingTypeOptions, meetingStatusOptions, splitTags, parseTags, parseParticipantIds, formatParticipantIds } from "./helpers";
import { SectionHeader } from "./SectionHeader";

function MeetingEditor({ companyId, agents, meeting, onSaved }: {
  companyId: string; agents: AgentRecord[]; meeting: MeetingRecord | null; onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(meeting?.title ?? "");
  const [type, setType] = useState(meeting?.type ?? "department_sync");
  const [status, setStatus] = useState(meeting?.status ?? "scheduled");
  const [scheduledAt, setScheduledAt] = useState(meeting?.scheduledAt?.slice(0, 16) ?? new Date().toISOString().slice(0, 16));
  const [durationMinutes, setDurationMinutes] = useState(String(meeting?.durationMinutes ?? 30));
  const [agenda, setAgenda] = useState(parseTags(meeting?.agendaJson ?? "[]"));
  const [notes, setNotes] = useState(parseTags(meeting?.notesJson ?? "[]"));
  const [decisions, setDecisions] = useState(parseTags(meeting?.decisionsJson ?? "[]"));
  const [participants, setParticipants] = useState(formatParticipantIds(meeting?.participantAgentIds ?? "[]", agents));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) { setError("Meeting title is required."); return; }
    setSaving(true); setError(null);
    try {
      const participantIds = parseParticipantIds(participants)
        .map((value) => agents.find((agent) => agent.name === value || agent.id === value)?.id ?? value)
        .filter(Boolean);
      const result = await window.agentCompany.saveMeeting({
        id: meeting?.id ?? null, companyId,
        type: type as Parameters<typeof window.agentCompany.saveMeeting>[0]["type"],
        title: title.trim(), organizerAgentId: meeting?.organizerAgentId ?? null,
        participantAgentIds: JSON.stringify(participantIds),
        scheduledAt: new Date(scheduledAt).toISOString(),
        durationMinutes: Number.parseInt(durationMinutes, 10) || 30,
        agendaJson: splitTags(agenda), notesJson: splitTags(notes),
        decisionsJson: splitTags(decisions), actionItemsJson: meeting?.actionItemsJson ?? "[]",
        status: status as Parameters<typeof window.agentCompany.saveMeeting>[0]["status"],
      });
      if (!result.ok) { setError(result.error.message); return; }
      await onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      {error ? <InlineNotice message={error} /> : null}
      <Input label="Title" value={title} onChange={setTitle} placeholder="Sprint review" />
      <div className="grid gap-4 md:grid-cols-2">
        <Select label="Type" value={type} onChange={(value) => setType(value as typeof type)} options={meetingTypeOptions} />
        <Select label="Status" value={status} onChange={(value) => setStatus(value as typeof status)} options={meetingStatusOptions} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Input label="Scheduled At" value={scheduledAt} onChange={setScheduledAt} type="datetime-local" />
        <Input label="Duration (minutes)" value={durationMinutes} onChange={setDurationMinutes} type="number" />
      </div>
      <Input label="Participants" value={participants} onChange={setParticipants} placeholder="Comma-separated agent names or ids" />
      <Input label="Agenda" value={agenda} onChange={setAgenda} placeholder="Planning, blockers, decisions" />
      <Input label="Notes" value={notes} onChange={setNotes} placeholder="Key notes" />
      <Input label="Decisions" value={decisions} onChange={setDecisions} placeholder="Decision 1, Decision 2" />
      <div className="flex justify-end">
        <ActionButton label={saving ? "Saving..." : meeting ? "Save meeting" : "Create meeting"} icon={FloppyDisk} tone="accent" onClick={() => void save()} loading={saving} />
      </div>
    </div>
  );
}

export function MeetingsManager({ companyId, meetings, agents, onRefresh }: {
  companyId: string; meetings: MeetingRecord[]; agents: AgentRecord[]; onRefresh: () => Promise<void>;
}) {
  const t = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const activeMeeting = useMemo(() => meetings.find((meeting) => meeting.id === editingId) ?? null, [meetings, editingId]);

  return (
    <div>
      <SectionHeader title={t("ops.meetings")} count={meetings.length} action={() => setEditingId("__new__")} />
      <ListFrame>
        {meetings.map((meeting) => (
          <ListRow key={meeting.id}>
            <div className="flex items-start justify-between gap-3">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditingId(meeting.id)}>
                <div className="flex items-center gap-2 text-[13px] font-medium text-[color:var(--text)]">
                  <CalendarBlank size={15} className="text-[color:var(--accent)]" />
                  <span className="truncate">{meeting.title}</span>
                </div>
                <div className="mt-1 text-[11px] text-[color:var(--muted)]">{meeting.type.replaceAll("_", " ")} · {new Date(meeting.scheduledAt).toLocaleString()} · {meeting.durationMinutes} min</div>
              </button>
              <div className="flex items-center gap-2">
                <StatusPill status={meeting.status} />
                <button type="button" className="rounded p-1 text-[color:var(--muted)] hover:text-[color:var(--text)]" onClick={() => setEditingId(meeting.id)}><NotePencil size={14} /></button>
                <button type="button" className="rounded p-1 text-[color:var(--muted)] hover:text-[color:var(--danger)]" onClick={() => setDeleteId(meeting.id)}><Trash size={14} /></button>
              </div>
            </div>
          </ListRow>
        ))}
      </ListFrame>
      <Modal open={editingId !== null} title={activeMeeting ? activeMeeting.title : "New meeting"} onClose={() => setEditingId(null)} width="760px">
        <MeetingEditor companyId={companyId} agents={agents} meeting={editingId === "__new__" ? null : activeMeeting} onSaved={async () => { setEditingId(null); await onRefresh(); }} />
      </Modal>
      <ConfirmDialog open={deleteId !== null} title="Delete meeting" message="This removes the meeting and its operational context from the company timeline." onCancel={() => setDeleteId(null)} onConfirm={async () => { if (!deleteId) return; const result = await window.agentCompany.deleteMeeting({ id: deleteId, companyId }); setDeleteId(null); if (result.ok) await onRefresh(); }} />
    </div>
  );
}
