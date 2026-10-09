import { useUnsaved } from "../../shared/unsaved";
import { useEffect, useState, type FormEvent } from "react";
import { Button, IconButton } from "../../shared/ui";
import type { FileObjectRecord } from "../../../../shared/domain";
import type { ThreadHistory } from "../../../../shared/chat-domain";
import { ChatMessageRow } from "./ChatMessageRow";
import { MentionTextarea } from "./MentionTextarea";
import type { MessageContext } from "./chat-helpers";
import { t } from "../../i18n/i18n";

/** One thread beside the conversation: its root and every answer, and a reply box that posts into it. */
export function ThreadPanel({
  orgId,
  threadId,
  refreshKey,
  files,
  context,
  onReply,
  onClose,
  onOpenFile,
}: {
  orgId: string;
  threadId: string;
  /** Changes with every snapshot reload, so new, edited and deleted messages show in the thread. */
  refreshKey: unknown;
  files: FileObjectRecord[];
  context: MessageContext;
  onReply: (body: string) => Promise<void>;
  onClose: () => void;
  onOpenFile: (fileId: string) => void;
}) {
  // The snapshot keeps only recent chat, so the thread is loaded whole on its own.
  const [history, setHistory] = useState<ThreadHistory | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    window.agentCompany.chatThreadHistory({ orgId, threadId }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setHistory(result.data);
        setLoadError(null);
      } else setLoadError(result.error.message);
    }).catch((reason: unknown) => {
      if (!cancelled) setLoadError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      cancelled = true;
    };
  }, [orgId, threadId, refreshKey]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTyped, setReplyTyped] = useState(false);
  useUnsaved(replyTyped);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const field = form.elements.namedItem("reply") as HTMLTextAreaElement;
    const body = field.value.trim();
    if (!body || pending) return;
    setPending(true);
    setError(null);
    // The reply stays in the box until it is saved, so a refused one loses nothing.
    onReply(body).then(() => {
      field.value = "";
      setReplyTyped(false);
      setPending(false);
    }).catch((reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      console.error(`[chat] thread reply failed: ${message}`);
      setError(message);
      setPending(false);
    });
  };
  return (
    <aside role="complementary" aria-label={t("Thread")} style={{ width: 360, flexShrink: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border-soft)", background: "var(--panel)" }}>
      <header className="row" style={{ height: 52, padding: "0 16px", borderBottom: "1px solid var(--border-soft)", flexShrink: 0 }}>
        <span style={{ fontSize: "var(--fs-body)" }}>{t("Thread")}</span>
        <span style={{ marginLeft: "auto" }}><IconButton icon="x" label={t("Close thread")} onClick={onClose} /></span>
      </header>
      <div style={{ flex: 1, overflow: "auto", padding: "16px 16px 8px" }}>
        {loadError && <div className="form-error" role="alert">{loadError}</div>}
        {history?.messages.map((message) => (
          <ChatMessageRow
            key={message.id}
            message={message}
            attachments={history.attachments}
            mentions={history.mentions}
            slashInvocations={history.slashInvocations}
            files={files}
            context={context}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
      <form onSubmit={submit} onInput={(event) => setReplyTyped(Boolean((event.currentTarget.elements.namedItem("reply") as HTMLTextAreaElement).value.trim()))} style={{ padding: 12, borderTop: "1px solid var(--border-soft)" }}>
        <MentionTextarea name="reply" rows={2} disabled={pending} ariaLabel={t("Reply")} agents={context.agents} employees={context.employees} />
        {error && <div className="form-error" role="alert">{t("Not sent: {reason}", { reason: error })}</div>}
        <div className="row" style={{ marginTop: 6 }}>
          <span style={{ marginLeft: "auto" }}><Button tone="primary" size="small" type="submit" disabled={pending}>{t("Send reply")}</Button></span>
        </div>
      </form>
    </aside>
  );
}
