import { riskLabel } from "../../i18n/labels";
import { useState, type ReactNode } from "react";
import { Button, Icon, Pill } from "../../shared/ui";
import type {
  ApprovalRecord,
  ChatAttachmentRecord,
  ChatMentionRecord,
  ChatMessageRecord,
  ChatSlashInvocationRecord,
  FileObjectRecord,
} from "../../../../shared/domain";
import { ChatMessageRow } from "./ChatMessageRow";
import type { ThreadLink } from "./thread-links";
import type { ChatReplyStatus } from "../../../../shared/chat-domain";
import { formatDay, type MessageContext } from "./chat-helpers";
import { t } from "../../i18n/i18n";

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
  pendingApprovals,
  attachments,
  mentions,
  slashInvocations,
  files,
  context,
  currentEmployeeId,
  historyStart,
  historyError,
  onLoadOlder,
  threadLinks,
  replyStatuses,
  onOpenThread,
  onApprove,
  onDecline,
  onEditMessage,
  onDeleteMessage,
  onOpenFile,
}: {
  messagesInSpace: ChatMessageRecord[];
  pendingApprovals: ApprovalRecord[];
  attachments: ChatAttachmentRecord[];
  mentions: ChatMentionRecord[];
  slashInvocations: ChatSlashInvocationRecord[];
  files: FileObjectRecord[];
  context: MessageContext;
  currentEmployeeId: string;
  /** True once the database said no older message exists. */
  historyStart: boolean;
  historyError: string | null;
  onLoadOlder: () => void;
  threadLinks: Map<string, ThreadLink>;
  replyStatuses: ChatReplyStatus[];
  onOpenThread: (threadId: string) => void;
  onApprove: (approvalId: string) => void;
  onDecline: (approvalId: string) => void;
  onEditMessage: (messageId: string, bodyMd: string) => Promise<void>;
  onDeleteMessage: (messageId: string) => void;
  onOpenFile: (fileId: string) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(WINDOW_SIZE);

  const attachmentsByMessage = groupBy(attachments, (item) => item.messageId);
  const repliesByMessage = groupBy(replyStatuses, (item) => item.messageId);
  const mentionsByMessage = groupBy(mentions, (item) => item.messageId);
  const invocationsByMessage = groupBy(slashInvocations, (item) => item.messageId);

  const hiddenCount = Math.max(0, messagesInSpace.length - visibleCount);
  const visible = hiddenCount > 0 ? messagesInSpace.slice(hiddenCount) : messagesInSpace;

  const elements: ReactNode[] = [];
  if (historyError) elements.push(<div key="history-error" className="form-error" role="alert">{t("Earlier messages could not load: {reason}", { reason: historyError })}</div>);
  if (hiddenCount > 0 || !historyStart) {
    // Showing earlier first reveals loaded messages, then asks the database for the next page.
    const showEarlier = () => {
      setVisibleCount((count) => count + WINDOW_SIZE);
      if (hiddenCount === 0) onLoadOlder();
    };
    elements.push(
      <div key="show-earlier" style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <Button size="small" onClick={showEarlier}>{t("Show earlier messages")}</Button>
      </div>,
    );
  } else {
    elements.push(<div key="history-start" style={{ textAlign: "center", fontSize: "var(--fs-body)", color: "var(--text-3)", marginBottom: 16 }}>{t("This is the start of the conversation.")}</div>);
  }
  let lastDay = "";
  for (const message of visible) {
    const day = formatDay(message.createdAt);
    if (day !== lastDay) {
      lastDay = day;
      elements.push(<DayDivider key={`day-${day}`} label={day} />);
    }
    const threadId = message.threadId;
    elements.push(
      <ChatMessageRow
        key={message.id}
        message={message}
        attachments={attachmentsByMessage.get(message.id) ?? EMPTY_ATTACHMENTS}
        mentions={mentionsByMessage.get(message.id) ?? EMPTY_MENTIONS}
        slashInvocations={invocationsByMessage.get(message.id) ?? EMPTY_INVOCATIONS}
        files={files}
        context={context}
        canModify={message.senderType === "employee" && message.senderId === currentEmployeeId && !message.deletedAt}
        thread={threadLinks.get(message.id)}
        replyStatuses={repliesByMessage.get(message.id)}
        onOpenThread={threadId ? () => onOpenThread(threadId) : undefined}
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
      <div style={{ fontSize: "var(--fs-body)", color: "var(--text-3)" }}>{label}</div>
      <div style={{ flex: 1, height: 1, background: "var(--border-soft)" }} />
    </div>
  );
}

function ApprovalInline({ approval, onApprove, onDecline }: { approval: ApprovalRecord; onApprove: () => void; onDecline: () => void }) {
  return (
    <div style={{ margin: "14px 0 18px 44px", maxWidth: 480, border: "1px solid var(--border-strong)", background: "var(--panel)", padding: 14 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <Icon name="approve" color="var(--amber)" />
        <span style={{ fontSize: "var(--fs-body)", color: "var(--amber)" }}>{t("Approval needed")}</span>
        <Pill tone={approval.risk === "high" ? "red" : approval.risk === "medium" ? "amber" : undefined}>{riskLabel(approval.risk)}</Pill>
      </div>
      <div style={{ fontSize: "var(--fs-body)", marginBottom: 4 }}>{approval.title}</div>
      <div style={{ fontSize: "var(--fs-body)", color: "var(--text-3)", marginBottom: 12, lineHeight: 1.5 }}>{approval.details}</div>
      <div className="row" style={{ gap: 6 }}>
        <Button tone="primary" size="small" onClick={onApprove}>{t("Approve")}</Button>
        <Button size="small" onClick={onDecline}>{t("Decline")}</Button>
      </div>
    </div>
  );
}
