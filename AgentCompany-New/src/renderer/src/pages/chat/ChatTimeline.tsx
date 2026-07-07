import type { ReactNode } from "react";
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
  const elements: ReactNode[] = [];
  let lastDay = "";
  for (const message of messagesInSpace) {
    const day = formatDay(message.createdAt);
    if (day !== lastDay) {
      lastDay = day;
      elements.push(<DayDivider key={`day-${day}`} label={day} />);
    }
    const thread = threadsInSpace.find((item) => item.rootMessageId === message.id) ?? null;
    const replyCount = thread
      ? messagesInSpace.filter((m) => m.threadId === thread.id && m.id !== thread.rootMessageId).length
      : 0;
    elements.push(
      <ChatMessageRow
        key={message.id}
        message={message}
        attachments={attachments}
        mentions={mentions}
        slashInvocations={slashInvocations}
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
