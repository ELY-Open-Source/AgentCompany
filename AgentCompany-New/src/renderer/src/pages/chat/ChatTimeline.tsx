import type { ReactNode } from "react";
import { Avatar, Button, Icon, Pill } from "../../shared/ui";
import type {
  ApprovalRecord,
  ChatAttachmentRecord,
  ChatMentionRecord,
  ChatMessageRecord,
  ChatSlashInvocationRecord,
  ChatThreadRecord,
  FileObjectRecord,
} from "../../../../shared/domain";
import { formatDay, senderName, type MessageContext } from "./chat-helpers";

export function ChatTimeline({
  rootMessages,
  messagesInSpace,
  threadsInSpace,
  pendingApprovals,
  attachments,
  mentions,
  slashInvocations,
  files,
  context,
  currentEmployeeId,
  onOpenThread,
  onApprove,
  onDecline,
  onEditMessage,
  onDeleteMessage,
  onOpenFile,
}: {
  rootMessages: ChatMessageRecord[];
  messagesInSpace: ChatMessageRecord[];
  threadsInSpace: ChatThreadRecord[];
  pendingApprovals: ApprovalRecord[];
  attachments: ChatAttachmentRecord[];
  mentions: ChatMentionRecord[];
  slashInvocations: ChatSlashInvocationRecord[];
  files: FileObjectRecord[];
  context: MessageContext;
  currentEmployeeId: string;
  onOpenThread: (threadId: string) => void;
  onApprove: (approvalId: string) => void;
  onDecline: (approvalId: string) => void;
  onEditMessage: (messageId: string, bodyMd: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onOpenFile: (fileId: string) => void;
}) {
  const elements: ReactNode[] = [];
  let lastDay = "";
  for (const message of rootMessages) {
    const day = formatDay(message.createdAt);
    if (day !== lastDay) {
      lastDay = day;
      elements.push(<DayDivider key={`day-${day}`} label={day} />);
    }
    const thread = threadsInSpace.find((t) => t.rootMessageId === message.id) ?? null;
    const replies = thread
      ? messagesInSpace.filter((m) => m.threadId === thread.id && m.id !== thread.rootMessageId)
      : [];
    const lastReply = replies.length > 0 ? replies[replies.length - 1] : null;
    const participantNames = threadParticipants(replies, context);
    elements.push(
      <ThreadRow
        key={message.id}
        message={message}
        thread={thread}
        replyCount={replies.length}
        lastReply={lastReply}
        participantNames={participantNames}
        context={context}
        onOpen={thread ? () => onOpenThread(thread.id) : null}
      />,
    );
  }
  for (const approval of pendingApprovals) {
    elements.push(
      <ApprovalInline
        key={`approval-${approval.id}`}
        approval={approval}
        onApprove={() => onApprove(approval.id)}
        onDecline={() => onDecline(approval.id)}
      />,
    );
  }
  return <>{elements}</>;
}

function ThreadRow({
  message,
  thread,
  replyCount,
  lastReply,
  participantNames,
  context,
  onOpen,
}: {
  message: ChatMessageRecord;
  thread: ChatThreadRecord | null;
  replyCount: number;
  lastReply: ChatMessageRecord | null;
  participantNames: string[];
  context: MessageContext;
  onOpen: (() => void) | null;
}) {
  const name = senderName(message, context);
  const bot = message.senderType === "agent";
  const preview = message.bodyMd.replace(/\n+/g, " ").slice(0, 120);
  const time = formatTime(message.createdAt);
  return (
    <button
      type="button"
      onClick={onOpen ?? undefined}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        width: "100%",
        padding: "10px 12px",
        border: 0,
        borderRadius: 8,
        background: "transparent",
        cursor: onOpen ? "pointer" : "default",
        textAlign: "left",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => { if (onOpen) e.currentTarget.style.background = "var(--hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <Avatar name={name} size="sm" bot={bot} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 560 }}>{name}</span>
          <span style={{ fontSize: 11, color: "var(--text-4)" }}>{time}</span>
        </div>
        <div style={{
          fontSize: 13,
          color: "var(--text-2)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          lineHeight: 1.4,
        }}>
          {preview}
        </div>
        {replyCount > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            {participantNames.slice(0, 3).map((n) => (
              <Avatar key={n} name={n} size="sm" bot />
            ))}
            <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 500 }}>
              {replyCount} {replyCount === 1 ? "reply" : "replies"}
            </span>
            {lastReply && (
              <span style={{ fontSize: 11, color: "var(--text-4)" }}>
                {formatTime(lastReply.createdAt)}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

function threadParticipants(replies: ChatMessageRecord[], context: MessageContext): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const r of replies) {
    const key = `${r.senderType}:${r.senderId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(senderName(r, context));
  }
  return names;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function DayDivider({ label }: { label: string }) {
  return (
    <div className="row" style={{ gap: 12, margin: "8px 0 12px" }}>
      <div style={{ flex: 1, height: 1, background: "var(--border-soft)" }} />
      <div style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 540 }}>{label}</div>
      <div style={{ flex: 1, height: 1, background: "var(--border-soft)" }} />
    </div>
  );
}

function ApprovalInline({
  approval,
  onApprove,
  onDecline,
}: {
  approval: ApprovalRecord;
  onApprove: () => void;
  onDecline: () => void;
}) {
  return (
    <div style={{ margin: "8px 0 12px 12px", maxWidth: 480, border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--panel)", padding: 14 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <Icon name="approve" size={14} color="var(--amber)" />
        <span style={{ fontSize: 12, color: "var(--amber)", fontWeight: 540 }}>Approval needed</span>
        <Pill tone={approval.risk === "high" ? "red" : approval.risk === "medium" ? "amber" : undefined}>{approval.risk}</Pill>
      </div>
      <div style={{ fontSize: 14, fontWeight: 540, marginBottom: 4 }}>{approval.title}</div>
      <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 12, lineHeight: 1.5 }}>{approval.details}</div>
      <div className="row" style={{ gap: 6 }}>
        <Button tone="primary" size="small" onClick={onApprove}>Approve</Button>
        <Button size="small" onClick={onDecline}>Decline</Button>
      </div>
    </div>
  );
}
