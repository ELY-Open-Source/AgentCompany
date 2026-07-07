import { useState, type ReactNode } from "react";
import { Button, Icon, Pill } from "../../shared/ui";
import type {
  ApprovalRecord,
  ChatAttachmentRecord,
  ChatMentionRecord,
  ChatMessageRecord,
  ChatSlashInvocationRecord,
  ChatThreadRecord,
  FileObjectRecord,
} from "../../../../shared/domain";
import { ChatMessageRow } from "./ChatMessageRow";
import { formatDay, type MessageContext } from "./chat-helpers";

const WINDOW_SIZE = 150;
const EMPTY_ATTACHMENTS: ChatAttachmentRecord[] = [];
const EMPTY_MENTIONS: ChatMentionRecord[] = [];
const EMPTY_INVOCATIONS: ChatSlashInvocationRecord[] = [];

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

export function ChatTimeline({
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
  const [visibleCount, setVisibleCount] = useState(WINDOW_SIZE);

  const attachmentsByMessage = groupBy(attachments, (item) => item.messageId);
  const mentionsByMessage = groupBy(mentions, (item) => item.messageId);
  const invocationsByMessage = groupBy(slashInvocations, (item) => item.messageId);
  const threadByRoot = new Map<string, ChatThreadRecord>();
  for (const thread of threadsInSpace) {
    if (thread.rootMessageId) threadByRoot.set(thread.rootMessageId, thread);
  }
  const replyCountByThread = new Map<string, number>();
  for (const message of messagesInSpace) {
    if (!message.threadId) continue;
    replyCountByThread.set(message.threadId, (replyCountByThread.get(message.threadId) ?? 0) + 1);
  }

  const hiddenCount = Math.max(0, messagesInSpace.length - visibleCount);
  const visible = hiddenCount > 0 ? messagesInSpace.slice(hiddenCount) : messagesInSpace;

  const elements: ReactNode[] = [];
  if (hiddenCount > 0) {
    elements.push(
      <div key="show-earlier" style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <Button size="small" onClick={() => setVisibleCount((count) => count + WINDOW_SIZE)}>
          Show earlier messages
        </Button>
      </div>,
    );
  }
  let lastDay = "";
  for (const message of visible) {
    const day = formatDay(message.createdAt);
    if (day !== lastDay) {
      lastDay = day;
      elements.push(<DayDivider key={`day-${day}`} label={day} />);
    }
    const thread = threadByRoot.get(message.id) ?? null;
    const replyCount = thread
      ? Math.max(0, (replyCountByThread.get(thread.id) ?? 0) - (thread.rootMessageId && message.threadId === thread.id ? 1 : 0))
      : 0;
    elements.push(
      <ChatMessageRow
        key={message.id}
        message={message}
        attachments={attachmentsByMessage.get(message.id) ?? EMPTY_ATTACHMENTS}
        mentions={mentionsByMessage.get(message.id) ?? EMPTY_MENTIONS}
        slashInvocations={invocationsByMessage.get(message.id) ?? EMPTY_INVOCATIONS}
        files={files}
        replyCount={replyCount}
        onOpenThread={thread ? () => onOpenThread(thread.id) : null}
        context={context}
        canModify={message.senderType === "employee" && message.senderId === currentEmployeeId && !message.deletedAt}
        onEdit={(bodyMd) => onEditMessage(message.id, bodyMd)}
        onDelete={() => onDeleteMessage(message.id)}
        onOpenFile={onOpenFile}
      />,
    );
  }
  for (const approval of pendingApprovals) {
    elements.push(
      <ApprovalInline key={`approval-${approval.id}`} approval={approval} onApprove={() => onApprove(approval.id)} onDecline={() => onDecline(approval.id)} />,
    );
  }
  return <>{elements}</>;
}

function DayDivider({ label }: { label: string }) {
  return (
    <div className="row" style={{ gap: 12, margin: "8px 0 16px" }}>
      <div style={{ flex: 1, height: 1, background: "var(--border-soft)" }} />
      <div style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 540 }}>{label}</div>
      <div style={{ flex: 1, height: 1, background: "var(--border-soft)" }} />
    </div>
  );
}

function ApprovalInline({ approval, onApprove, onDecline }: { approval: ApprovalRecord; onApprove: () => void; onDecline: () => void }) {
  return (
    <div style={{ margin: "14px 0 18px 44px", maxWidth: 480, border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--panel)", padding: 14 }}>
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
