import { useMemo, useState } from "react";
import {
  CalendarBlank,
  FileText,
  FloppyDisk,
  Lightbulb,
  NotePencil,
  Plus,
  Rows,
  Trash,
} from "@phosphor-icons/react";
import type {
  AgentRecord,
  DocumentRecord,
  GoalRecord,
  KnowledgeEntryRecord,
  MeetingRecord,
  ProjectRecord,
  SprintRecord,
} from "@shared/types";
import { ActionButton, ConfirmDialog, InlineNotice, Input, ListFrame, ListRow, Modal, Select, StatusPill, TextArea } from "./ui";
import { useT } from "../i18n";

const documentTypeOptions = [
  "prd",
  "technical_spec",
  "design_doc",
  "test_plan",
  "post_mortem",
  "meeting_notes",
  "budget_proposal",
  "hiring_requisition",
  "performance_review_doc",
  "sop",
  "knowledge_article",
  "project_brief",
  "sprint_report",
  "incident_report",
  "onboarding_guide",
  "architecture_decision",
  "status_report",
  "contract",
  "proposal",
].map((value) => ({ value, label: value.replaceAll("_", " ") }));

const documentStatusOptions = ["draft", "in_review", "approved", "archived", "superseded"].map((value) => ({
  value,
  label: value.replaceAll("_", " "),
}));

const knowledgeCategoryOptions = [
  "lesson_learned",
  "best_practice",
  "decision",
  "process",
  "technical",
  "business",
  "onboarding",
  "incident",
].map((value) => ({ value, label: value.replaceAll("_", " ") }));

const importanceOptions = ["critical", "high", "medium", "low"].map((value) => ({ value, label: value }));

const meetingTypeOptions = [
  "standup",
  "sprint_planning",
  "sprint_review",
  "retrospective",
  "one_on_one",
  "all_hands",
  "department_sync",
  "incident_review",
  "hiring_committee",
  "budget_review",
  "design_review",
  "architecture_review",
].map((value) => ({ value, label: value.replaceAll("_", " ") }));

const meetingStatusOptions = ["scheduled", "in_progress", "completed", "cancelled"].map((value) => ({ value, label: value.replaceAll("_", " ") }));
const sprintStatusOptions = ["planning", "active", "review", "completed", "cancelled"].map((value) => ({ value, label: value }));

function splitTags(value: string) {
  return JSON.stringify(value.split(",").map((item) => item.trim()).filter(Boolean));
}

function parseTags(value: string) {
  try {
    const tags = JSON.parse(value) as string[];
    return tags.join(", ");
  } catch {
    return "";
  }
}

function parseParticipantIds(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatParticipantIds(raw: string, agents: AgentRecord[]) {
  try {
    const ids = JSON.parse(raw) as string[];
    return ids
      .map((id) => agents.find((agent) => agent.id === id)?.name ?? id.slice(0, 8))
      .join(", ");
  } catch {
    return "";
  }
}

function DocumentEditor({
  companyId,
  agents,
  projects,
  goals,
  document,
  onSaved,
}: {
  companyId: string;
  agents: AgentRecord[];
  projects: ProjectRecord[];
  goals: GoalRecord[];
  document: DocumentRecord | null;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(document?.title ?? "");
  const [type, setType] = useState(document?.type ?? "technical_spec");
  const [content, setContent] = useState(document?.content ?? "");
  const [status, setStatus] = useState(document?.status ?? "draft");
  const [reviewerAgentId, setReviewerAgentId] = useState(document?.reviewerAgentId ?? "");
  const [projectId, setProjectId] = useState(document?.projectId ?? "");
  const [goalId, setGoalId] = useState(document?.goalId ?? "");
  const [tags, setTags] = useState(parseTags(document?.tagsJson ?? "[]"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) {
      setError("Document title is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await window.agentCompany.saveDocument({
        id: document?.id ?? null,
        companyId,
        type: type as Parameters<typeof window.agentCompany.saveDocument>[0]["type"],
        title: title.trim(),
        content,
        authorAgentId: document?.authorAgentId ?? null,
        reviewerAgentId: reviewerAgentId || null,
        projectId: projectId || null,
        goalId: goalId || null,
        parentDocId: document?.parentDocId ?? null,
        version: document?.version ?? 1,
        status: status as Parameters<typeof window.agentCompany.saveDocument>[0]["status"],
        tagsJson: splitTags(tags),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <InlineNotice message={error} /> : null}
      <Input label="Title" value={title} onChange={setTitle} placeholder="Architecture review summary" />
      <div className="grid gap-4 md:grid-cols-2">
        <Select label="Type" value={type} onChange={(value) => setType(value as typeof type)} options={documentTypeOptions} />
        <Select label="Status" value={status} onChange={(value) => setStatus(value as typeof status)} options={documentStatusOptions} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Select
          label="Reviewer"
          value={reviewerAgentId}
          onChange={setReviewerAgentId}
          options={[{ value: "", label: "None" }, ...agents.map((agent) => ({ value: agent.id, label: `${agent.name} (${agent.role})` }))]}
        />
        <Input label="Tags" value={tags} onChange={setTags} placeholder="architecture, security, release" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Select label="Project" value={projectId} onChange={setProjectId} options={[{ value: "", label: "None" }, ...projects.map((project) => ({ value: project.id, label: project.name }))]} />
        <Select label="Goal" value={goalId} onChange={setGoalId} options={[{ value: "", label: "None" }, ...goals.map((goal) => ({ value: goal.id, label: goal.title }))]} />
      </div>
      <TextArea label="Content" value={content} onChange={setContent} rows={12} placeholder="Write the document content here." />
      <div className="flex justify-end">
        <ActionButton label={saving ? "Saving..." : document ? "Save document" : "Create document"} icon={FloppyDisk} tone="accent" onClick={() => void save()} loading={saving} />
      </div>
    </div>
  );
}

function KnowledgeEditor({
  companyId,
  entry,
  onSaved,
}: {
  companyId: string;
  entry: KnowledgeEntryRecord | null;
  onSaved: () => Promise<void>;
}) {
  const [topic, setTopic] = useState(entry?.topic ?? "");
  const [category, setCategory] = useState(entry?.category ?? "technical");
  const [importance, setImportance] = useState(entry?.importance ?? "medium");
  const [content, setContent] = useState(entry?.content ?? "");
  const [tags, setTags] = useState(parseTags(entry?.tagsJson ?? "[]"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!topic.trim() || !content.trim()) {
      setError("Topic and content are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await window.agentCompany.saveKnowledgeEntry({
        id: entry?.id ?? null,
        companyId,
        category: category as Parameters<typeof window.agentCompany.saveKnowledgeEntry>[0]["category"],
        topic: topic.trim(),
        content: content.trim(),
        authorAgentId: entry?.authorAgentId ?? null,
        importance: importance as Parameters<typeof window.agentCompany.saveKnowledgeEntry>[0]["importance"],
        tagsJson: splitTags(tags),
        referencedEntityType: entry?.referencedEntityType ?? null,
        referencedEntityId: entry?.referencedEntityId ?? null,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <InlineNotice message={error} /> : null}
      <Input label="Topic" value={topic} onChange={setTopic} placeholder="What did the team learn?" />
      <div className="grid gap-4 md:grid-cols-2">
        <Select label="Category" value={category} onChange={(value) => setCategory(value as typeof category)} options={knowledgeCategoryOptions} />
        <Select label="Importance" value={importance} onChange={(value) => setImportance(value as typeof importance)} options={importanceOptions} />
      </div>
      <Input label="Tags" value={tags} onChange={setTags} placeholder="incident, auth, onboarding" />
      <TextArea label="Content" value={content} onChange={setContent} rows={10} placeholder="Capture the lesson, decision, or process in full." />
      <div className="flex justify-end">
        <ActionButton label={saving ? "Saving..." : entry ? "Save entry" : "Create entry"} icon={FloppyDisk} tone="accent" onClick={() => void save()} loading={saving} />
      </div>
    </div>
  );
}

function MeetingEditor({
  companyId,
  agents,
  meeting,
  onSaved,
}: {
  companyId: string;
  agents: AgentRecord[];
  meeting: MeetingRecord | null;
  onSaved: () => Promise<void>;
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
    if (!title.trim()) {
      setError("Meeting title is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const participantIds = parseParticipantIds(participants)
        .map((value) => agents.find((agent) => agent.name === value || agent.id === value)?.id ?? value)
        .filter(Boolean);
      const result = await window.agentCompany.saveMeeting({
        id: meeting?.id ?? null,
        companyId,
        type: type as Parameters<typeof window.agentCompany.saveMeeting>[0]["type"],
        title: title.trim(),
        organizerAgentId: meeting?.organizerAgentId ?? null,
        participantAgentIds: JSON.stringify(participantIds),
        scheduledAt: new Date(scheduledAt).toISOString(),
        durationMinutes: Number.parseInt(durationMinutes, 10) || 30,
        agendaJson: splitTags(agenda),
        notesJson: splitTags(notes),
        decisionsJson: splitTags(decisions),
        actionItemsJson: meeting?.actionItemsJson ?? "[]",
        status: status as Parameters<typeof window.agentCompany.saveMeeting>[0]["status"],
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      await onSaved();
    } finally {
      setSaving(false);
    }
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

function SprintEditor({
  companyId,
  sprint,
  onSaved,
}: {
  companyId: string;
  sprint: SprintRecord | null;
  onSaved: () => Promise<void>;
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
    if (!name.trim()) {
      setError("Sprint name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await window.agentCompany.saveSprint({
        id: sprint?.id ?? null,
        companyId,
        name: name.trim(),
        goal: goal.trim(),
        startDate,
        endDate,
        status: status as Parameters<typeof window.agentCompany.saveSprint>[0]["status"],
        retrospectiveNotes,
        velocityPoints: Number.parseInt(velocityPoints, 10) || 0,
        completedPoints: Number.parseInt(completedPoints, 10) || 0,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      await onSaved();
    } finally {
      setSaving(false);
    }
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

function SectionHeader({
  title,
  count,
  action,
}: {
  title: string;
  count: number;
  action: () => void;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div>
        <div className="text-[16px] font-semibold text-[color:var(--text)]">{title}</div>
        <div className="text-[12px] text-[color:var(--muted)]">{count} item{count === 1 ? "" : "s"}</div>
      </div>
      <ActionButton label="New" icon={Plus} tone="accent" onClick={action} />
    </div>
  );
}

export function DocumentCenter({
  companyId,
  documents,
  agents,
  projects,
  goals,
  onRefresh,
}: {
  companyId: string;
  documents: DocumentRecord[];
  agents: AgentRecord[];
  projects: ProjectRecord[];
  goals: GoalRecord[];
  onRefresh: () => Promise<void>;
}) {
  const t = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const activeDocument = useMemo(() => documents.find((document) => document.id === editingId) ?? null, [documents, editingId]);

  return (
    <div>
      <SectionHeader title={t("ops.documentCenter")} count={documents.length} action={() => setEditingId("__new__")} />
      <ListFrame>
        {documents.map((document) => (
          <ListRow key={document.id}>
            <div className="flex items-start justify-between gap-3">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditingId(document.id)}>
                <div className="flex items-center gap-2 text-[13px] font-medium text-[color:var(--text)]">
                  <FileText size={15} className="text-[color:var(--accent)]" />
                  <span className="truncate">{document.title}</span>
                </div>
                <div className="mt-1 text-[11px] text-[color:var(--muted)]">
                  {document.type.replaceAll("_", " ")} · v{document.version} · {document.updatedAt.slice(0, 10)}
                </div>
              </button>
              <div className="flex items-center gap-2">
                <StatusPill status={document.status} />
                <button type="button" className="rounded p-1 text-[color:var(--muted)] hover:text-[color:var(--text)]" onClick={() => setEditingId(document.id)}>
                  <NotePencil size={14} />
                </button>
                <button type="button" className="rounded p-1 text-[color:var(--muted)] hover:text-[color:var(--danger)]" onClick={() => setDeleteId(document.id)}>
                  <Trash size={14} />
                </button>
              </div>
            </div>
          </ListRow>
        ))}
      </ListFrame>
      <Modal open={editingId !== null} title={activeDocument ? activeDocument.title : "New document"} onClose={() => setEditingId(null)} width="760px">
        <DocumentEditor
          companyId={companyId}
          agents={agents}
          projects={projects}
          goals={goals}
          document={editingId === "__new__" ? null : activeDocument}
          onSaved={async () => {
            setEditingId(null);
            await onRefresh();
          }}
        />
      </Modal>
      <ConfirmDialog
        open={deleteId !== null}
        title="Delete document"
        message="This removes the document from the company knowledge surface."
        onCancel={() => setDeleteId(null)}
        onConfirm={async () => {
          if (!deleteId) return;
          const result = await window.agentCompany.deleteDocument({ id: deleteId, companyId });
          setDeleteId(null);
          if (result.ok) await onRefresh();
        }}
      />
    </div>
  );
}

export function KnowledgeBaseManager({
  companyId,
  entries,
  onRefresh,
}: {
  companyId: string;
  entries: KnowledgeEntryRecord[];
  onRefresh: () => Promise<void>;
}) {
  const t = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const activeEntry = useMemo(() => entries.find((entry) => entry.id === editingId) ?? null, [entries, editingId]);

  return (
    <div>
      <SectionHeader title={t("ops.knowledgeBase")} count={entries.length} action={() => setEditingId("__new__")} />
      <ListFrame>
        {entries.map((entry) => (
          <ListRow key={entry.id}>
            <div className="flex items-start justify-between gap-3">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditingId(entry.id)}>
                <div className="flex items-center gap-2 text-[13px] font-medium text-[color:var(--text)]">
                  <Lightbulb size={15} className="text-[color:var(--accent)]" />
                  <span className="truncate">{entry.topic}</span>
                </div>
                <div className="mt-1 text-[11px] text-[color:var(--muted)]">
                  {entry.category.replaceAll("_", " ")} · {entry.updatedAt.slice(0, 10)}
                </div>
              </button>
              <div className="flex items-center gap-2">
                <StatusPill status={entry.importance} />
                <button type="button" className="rounded p-1 text-[color:var(--muted)] hover:text-[color:var(--text)]" onClick={() => setEditingId(entry.id)}>
                  <NotePencil size={14} />
                </button>
                <button type="button" className="rounded p-1 text-[color:var(--muted)] hover:text-[color:var(--danger)]" onClick={() => setDeleteId(entry.id)}>
                  <Trash size={14} />
                </button>
              </div>
            </div>
          </ListRow>
        ))}
      </ListFrame>
      <Modal open={editingId !== null} title={activeEntry ? activeEntry.topic : "New knowledge entry"} onClose={() => setEditingId(null)} width="760px">
        <KnowledgeEditor
          companyId={companyId}
          entry={editingId === "__new__" ? null : activeEntry}
          onSaved={async () => {
            setEditingId(null);
            await onRefresh();
          }}
        />
      </Modal>
      <ConfirmDialog
        open={deleteId !== null}
        title="Delete knowledge entry"
        message="This removes the entry from the shared company knowledge base."
        onCancel={() => setDeleteId(null)}
        onConfirm={async () => {
          if (!deleteId) return;
          const result = await window.agentCompany.deleteKnowledgeEntry({ id: deleteId, companyId });
          setDeleteId(null);
          if (result.ok) await onRefresh();
        }}
      />
    </div>
  );
}

export function MeetingsManager({
  companyId,
  meetings,
  agents,
  onRefresh,
}: {
  companyId: string;
  meetings: MeetingRecord[];
  agents: AgentRecord[];
  onRefresh: () => Promise<void>;
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
                <div className="mt-1 text-[11px] text-[color:var(--muted)]">
                  {meeting.type.replaceAll("_", " ")} · {new Date(meeting.scheduledAt).toLocaleString()} · {meeting.durationMinutes} min
                </div>
              </button>
              <div className="flex items-center gap-2">
                <StatusPill status={meeting.status} />
                <button type="button" className="rounded p-1 text-[color:var(--muted)] hover:text-[color:var(--text)]" onClick={() => setEditingId(meeting.id)}>
                  <NotePencil size={14} />
                </button>
                <button type="button" className="rounded p-1 text-[color:var(--muted)] hover:text-[color:var(--danger)]" onClick={() => setDeleteId(meeting.id)}>
                  <Trash size={14} />
                </button>
              </div>
            </div>
          </ListRow>
        ))}
      </ListFrame>
      <Modal open={editingId !== null} title={activeMeeting ? activeMeeting.title : "New meeting"} onClose={() => setEditingId(null)} width="760px">
        <MeetingEditor
          companyId={companyId}
          agents={agents}
          meeting={editingId === "__new__" ? null : activeMeeting}
          onSaved={async () => {
            setEditingId(null);
            await onRefresh();
          }}
        />
      </Modal>
      <ConfirmDialog
        open={deleteId !== null}
        title="Delete meeting"
        message="This removes the meeting and its operational context from the company timeline."
        onCancel={() => setDeleteId(null)}
        onConfirm={async () => {
          if (!deleteId) return;
          const result = await window.agentCompany.deleteMeeting({ id: deleteId, companyId });
          setDeleteId(null);
          if (result.ok) await onRefresh();
        }}
      />
    </div>
  );
}

export function SprintManager({
  companyId,
  sprints,
  onRefresh,
}: {
  companyId: string;
  sprints: SprintRecord[];
  onRefresh: () => Promise<void>;
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
                <div className="mt-1 text-[11px] text-[color:var(--muted)]">
                  {sprint.startDate} → {sprint.endDate} · {sprint.completedPoints}/{sprint.velocityPoints} pts
                </div>
              </button>
              <div className="flex items-center gap-2">
                <StatusPill status={sprint.status} />
                <button type="button" className="rounded p-1 text-[color:var(--muted)] hover:text-[color:var(--text)]" onClick={() => setEditingId(sprint.id)}>
                  <NotePencil size={14} />
                </button>
                <button type="button" className="rounded p-1 text-[color:var(--muted)] hover:text-[color:var(--danger)]" onClick={() => setDeleteId(sprint.id)}>
                  <Trash size={14} />
                </button>
              </div>
            </div>
          </ListRow>
        ))}
      </ListFrame>
      <Modal open={editingId !== null} title={activeSprint ? activeSprint.name : "New sprint"} onClose={() => setEditingId(null)} width="720px">
        <SprintEditor
          companyId={companyId}
          sprint={editingId === "__new__" ? null : activeSprint}
          onSaved={async () => {
            setEditingId(null);
            await onRefresh();
          }}
        />
      </Modal>
      <ConfirmDialog
        open={deleteId !== null}
        title="Delete sprint"
        message="This removes the sprint board entry. Historical run and task records remain."
        onCancel={() => setDeleteId(null)}
        onConfirm={async () => {
          if (!deleteId) return;
          const result = await window.agentCompany.deleteSprint({ id: deleteId, companyId });
          setDeleteId(null);
          if (result.ok) await onRefresh();
        }}
      />
    </div>
  );
}
