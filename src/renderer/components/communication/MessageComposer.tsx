import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentMessageRecord,
  AgentRecord,
  DocumentRecord,
  MessageChannel,
} from "@shared/types";
import { cmdOrCtrlLabel } from "../../lib/platform";
import { InlineNotice } from "../ui";
import { useT } from "../../i18n";
import { ComposerShell } from "./composer-shell/ComposerShell";
import {
  AttachmentChips,
  ComposerAttachments,
  type AttachmentItem,
} from "./composer/ComposerAttachments";
import { ComposerMentionDropdown } from "./composer/ComposerMentionDropdown";
import { ComposerReplyBanner } from "./composer/ComposerReplyBanner";
import { ComposerSubjectRow } from "./composer/ComposerSubjectRow";
import { useMentionState } from "./composer/useMentionState";
import { useMessageSend } from "./composer/useMessageSend";

export { TaskDiscussionComposer } from "./composer/TaskDiscussionComposer";
export { NoChannelComposer } from "./composer/NoChannelComposer";

const HUMAN_SENDER_ID = "__board__";

interface MessageComposerProps {
  agents: AgentRecord[];
  companyId: string;
  channel: MessageChannel;
  channelTargetId: string | null;
  directParticipantIds?: string[];
  replyTo: AgentMessageRecord | null;
  onSent: () => void;
  onCancelReply: () => void;
  documents?: DocumentRecord[];
  /** Thread ID for precise checkpoint resolution. */
  threadId?: string | null;
  /** Wait state ID for precise checkpoint resolution. */
  waitStateId?: string | null;
}

export function MessageComposer({
  agents,
  companyId,
  channel,
  channelTargetId,
  directParticipantIds = [],
  replyTo,
  onSent,
  onCancelReply,
  documents = [],
  threadId = null,
  waitStateId = null,
}: MessageComposerProps) {
  const t = useT();
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  const directRecipientId = useMemo(() => {
    if (channel !== "direct") return null;
    if (replyTo?.fromAgentId) return replyTo.fromAgentId;
    if (directParticipantIds.length === 0) return null;
    const nonBoard = directParticipantIds.find((id) => id !== HUMAN_SENDER_ID);
    return nonBoard ?? directParticipantIds[0] ?? null;
  }, [channel, replyTo, directParticipantIds]);

  const onCleared = useCallback(() => {
    setBody("");
    setSubject("");
    setAttachments([]);
    onSent();
  }, [onSent]);

  const { send, sending, sendError } = useMessageSend({
    body, subject, attachments, channel, channelTargetId, companyId,
    directRecipientId, replyTo, threadId, waitStateId, onCleared,
  });

  const { mentionState, detect, selectAgent } = useMentionState({
    setBody,
    focusTextarea: () => textareaRef.current?.focus(),
  });

  const handleBodyChange = useCallback(
    (value: string, e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setBody(value);
      detect(value, e.target);
    },
    [detect],
  );

  const addAttachment = useCallback((doc: DocumentRecord) => {
    setAttachments((prev) => [...prev, { type: "document", id: doc.id, title: doc.title }]);
  }, []);
  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return (
    <div className="relative border-t border-border bg-card px-4 py-3">
      {channel === "direct" && !directRecipientId ? (
        <div className="mb-2">
          <InlineNotice message={t("composer.directMissingNotice")} />
        </div>
      ) : null}
      <ComposerShell
        ref={textareaRef}
        value={body}
        onChange={handleBodyChange}
        onSend={() => void send()}
        placeholder={t("composer.typeMessage")}
        sending={sending}
        error={sendError}
        shortcutHint={`Press ${cmdOrCtrlLabel()}+Enter to send`}
        sendLabel={t("composer.sendMessage")}
        sendDisabled={!body.trim() || (channel === "direct" && !directRecipientId)}
        leading={
          <ComposerAttachments
            documents={documents}
            attachments={attachments}
            onAdd={addAttachment}
            onRemove={removeAttachment}
          />
        }
        belowHeader={
          <>
            <ComposerReplyBanner replyTo={replyTo} agents={agents} onCancel={onCancelReply} />
            <ComposerSubjectRow
              subject={subject}
              onSubjectChange={setSubject}
              showSubjectInput={!replyTo}
            />
            <AttachmentChips attachments={attachments} onRemove={removeAttachment} />
          </>
        }
        onKeyDownExtra={() => mentionState.active}
        textareaAriaLabel={t("composer.messageBody")}
      />

      {mentionState.active && textareaRef.current ? (
        <ComposerMentionDropdown
          agents={agents}
          query={mentionState.query}
          onSelect={selectAgent}
          position={{
            top: textareaRef.current.offsetTop + mentionState.caretTop,
            left: textareaRef.current.offsetLeft + mentionState.caretLeft,
          }}
        />
      ) : null}
    </div>
  );
}
