import { useMemo, useState, type FormEvent } from "react";
import { Button, Field, Icon, IconButton, Pill } from "../shared/ui";
import { TopbarActions } from "../shared/TopbarActions";
import { Dialog } from "../shared/Dialog";
import type { PageProps } from "./types";
import { activeOrgId } from "./types";

const MEETING_TYPES = ["standup", "all_hands", "sprint_review", "retrospective", "planning", "one_on_one", "ad_hoc"] as const;

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function MeetingsPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const meetings = useMemo(() => snapshot.meetings.filter((m) => m.orgId === orgId), [snapshot.meetings, orgId]);
  const [createOpen, setCreateOpen] = useState(false);

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scheduledAt = text(form, "scheduledAt");
    void actions.run(() => window.agentCompany.createMeeting({
      orgId,
      title: text(form, "title"),
      meetingType: text(form, "meetingType"),
      scheduledAt: scheduledAt || null,
      durationMinutes: Number(text(form, "durationMinutes")) || 30,
      agenda: text(form, "agenda"),
    })).then((r) => { if (r) setCreateOpen(false); });
  };

  const remove = (meetingId: string) => {
    void actions.run(() => window.agentCompany.deleteMeeting({ orgId, meetingId }));
  };

  const scheduled = meetings.filter((m) => m.status === "scheduled");
  const completed = meetings.filter((m) => m.status !== "scheduled");

  return (
    <div className="page">
      <TopbarActions>
        <Button tone="primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={16} /> Schedule</Button>
      </TopbarActions>
      <h1 className="page-h1">Meetings</h1>
      <p className="page-sub">{scheduled.length} upcoming · {completed.length} past</p>

      {scheduled.length > 0 && <div className="section-label" style={{ marginBottom: 10 }}>Upcoming</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
        {scheduled.map((m) => (
          <MeetingCard key={m.id} meeting={m} onDelete={() => remove(m.id)} />
        ))}
      </div>

      {completed.length > 0 && (
        <>
          <div className="section-label" style={{ marginBottom: 10 }}>Past</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {completed.map((m) => (
              <MeetingCard key={m.id} meeting={m} onDelete={() => remove(m.id)} />
            ))}
          </div>
        </>
      )}

      <Dialog title="Schedule meeting" open={createOpen} submitLabel="Schedule" onClose={() => setCreateOpen(false)} onSubmit={create}>
        <Field label="Title"><input className="input" name="title" required /></Field>
        <Field label="Type">
          <select className="input" name="meetingType" defaultValue="standup">
            {MEETING_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
        </Field>
        <Field label="Scheduled at"><input className="input" name="scheduledAt" type="datetime-local" /></Field>
        <Field label="Duration (min)"><input className="input" name="durationMinutes" type="number" defaultValue="30" min="5" /></Field>
        <Field label="Agenda"><textarea className="input" name="agenda" rows={3} /></Field>
      </Dialog>
    </div>
  );
}

function MeetingCard({ meeting, onDelete }: { meeting: { id: string; title: string; meetingType: string; status: string; scheduledAt: string | null; durationMinutes: number; agenda: string; createdAt: string }; onDelete: () => void }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <span style={{ fontWeight: 540, flex: 1 }}>{meeting.title}</span>
        <IconButton icon="x" label="Delete" onClick={onDelete} />
      </div>
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        <Pill>{meeting.meetingType.replace(/_/g, " ")}</Pill>
        <Pill tone={meeting.status === "scheduled" ? "amber" : undefined}>{meeting.status}</Pill>
        <Pill>{meeting.durationMinutes}m</Pill>
      </div>
      {meeting.scheduledAt && <div style={{ fontSize: 12, color: "var(--text-3)" }}>{new Date(meeting.scheduledAt).toLocaleString()}</div>}
      {meeting.agenda && <div style={{ fontSize: 14, color: "var(--text-2)", marginTop: 6, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{meeting.agenda}</div>}
    </div>
  );
}
