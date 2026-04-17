import { useCallback, useState } from "react";
import { unwrap } from "../../../lib/desktop";
import { ComposerShell } from "../composer-shell/ComposerShell";
import { useT } from "../../../i18n";

export function TaskDiscussionComposer({
  companyId,
  taskId,
  onSent,
}: {
  companyId: string;
  taskId: string;
  onSent: () => void;
}) {
  const t = useT();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const handleSend = useCallback(async () => {
    if (!body.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      unwrap(
        await window.agentCompany.addComment({
          companyId,
          taskId,
          authorName: "Board",
          body: body.trim(),
        }),
      );
      setBody("");
      onSent();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : t("composer.sendFailedShort"));
    } finally {
      setSending(false);
    }
  }, [body, companyId, taskId, onSent, t]);

  return (
    <div className="border-t border-border bg-card px-4 py-3">
      <ComposerShell
        value={body}
        onChange={(v) => setBody(v)}
        onSend={() => void handleSend()}
        placeholder={t("composer.taskDiscussionPlaceholder")}
        sending={sending}
        error={sendError}
        sendLabel={t("composer.sendTaskComment")}
        textareaAriaLabel={t("composer.taskDiscussionReply")}
      />
    </div>
  );
}
