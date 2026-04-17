import { useCallback, useState } from "react";
import type { AgentMessageRecord, MessageChannel } from "@shared/types";
import { unwrap } from "../../../lib/desktop";
import { useAppStore } from "../../../state/store";
import { useT } from "../../../i18n";
import type { AttachmentItem } from "./ComposerAttachments";

const HUMAN_SENDER_ID = "__board__";

interface UseMessageSendArgs {
  body: string;
  subject: string;
  attachments: AttachmentItem[];
  channel: MessageChannel;
  channelTargetId: string | null;
  companyId: string;
  directRecipientId: string | null;
  replyTo: AgentMessageRecord | null;
  threadId?: string | null;
  waitStateId?: string | null;
  onCleared: () => void;
}

export function useMessageSend({
  body,
  subject,
  attachments,
  channel,
  channelTargetId,
  companyId,
  directRecipientId,
  replyTo,
  threadId = null,
  waitStateId = null,
  onCleared,
}: UseMessageSendArgs) {
  const t = useT();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const addToast = useAppStore((s) => s.addToast);

  const send = useCallback(async () => {
    if (!body.trim()) return;
    if (channel === "direct" && !directRecipientId) return;
    setSending(true);
    setSendError(null);
    const attachmentsJson = attachments.length > 0 ? JSON.stringify(attachments) : "[]";
    try {
      const result = unwrap(
        await window.agentCompany.sendAgentMessage({
          companyId,
          fromAgentId: HUMAN_SENDER_ID,
          toAgentId: channel === "direct" ? directRecipientId : null,
          channel,
          channelTargetId,
          subject: subject.trim() || (replyTo ? `Re: ${replyTo.subject}` : ""),
          body: body.trim(),
          priority: "normal",
          parentMessageId: replyTo?.id ?? null,
          attachmentsJson,
          threadId: threadId ?? undefined,
          waitStateId: waitStateId ?? undefined,
        }),
      );
      if (result.mentionResults && result.mentionResults.length > 0) {
        const woken = result.mentionResults.filter((m) => m.outcome === "woken");
        const queued = result.mentionResults.filter((m) => m.outcome === "queued");
        const busy = result.mentionResults.filter((m) => m.outcome === "busy");
        if (woken.length > 0)
          addToast(`${t("composer.notified")}: ${woken.map((m) => m.agentName).join(", ")}`, "success");
        if (queued.length > 0)
          addToast(`${t("composer.queued")}: ${queued.map((m) => m.agentName).join(", ")}`, "warn");
        if (busy.length > 0)
          addToast(`${t("composer.busy")}: ${busy.map((m) => m.agentName).join(", ")}`, "warn");
      }
      onCleared();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : t("composer.sendFailed"));
    } finally {
      setSending(false);
    }
  }, [
    body,
    channel,
    channelTargetId,
    companyId,
    directRecipientId,
    onCleared,
    replyTo,
    subject,
    attachments,
    threadId,
    waitStateId,
    addToast,
    t,
  ]);

  return { send, sending, sendError };
}
