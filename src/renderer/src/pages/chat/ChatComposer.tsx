import { noteTyping } from "./draft-store";
import { shortcutLabel } from "../../i18n/labels";
import { useEffect, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import { Button, Icon, IconButton } from "../../shared/ui";
import type { AgentRecord, EmployeeRecord, FileObjectRecord } from "../../../../shared/domain";
import { SLASH_COMMANDS } from "./chat-helpers";
import { MentionTextarea } from "./MentionTextarea";
import { t } from "../../i18n/i18n";

/** Whether a send is in flight, and why the last one was refused. */
export interface SendState {
  pending: boolean;
  error: string | null;
}

/** A conversation's unsent message: its text and the files picked to go with it. */
export interface Draft {
  body: string;
  attachmentFileIds: string[];
}

export function ChatComposer({
  disabled,
  send,
  draft,
  attachError,
  spaceId,
  onLeave,
  files,
  agents,
  employees,
  onAttachmentRemove,
  onAttach,
  onSubmit,
  composerRef,
}: {
  disabled: boolean;
  send: SendState;
  draft: Draft;
  /** Why some picked files could not be attached, or null. */
  attachError: string | null;
  spaceId: string | null;
  /** Called with the unsent text when the composer goes away, so the conversation keeps it; must be stable. */
  onLeave: (spaceId: string, body: string) => void;
  files: FileObjectRecord[];
  agents: AgentRecord[];
  employees: EmployeeRecord[];
  onAttachmentRemove: (fileId: string) => void;
  onAttach: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  composerRef: MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const [slashOpen, setSlashOpen] = useState(false);
  // While a send is in flight nothing may change the draft it will clear on success.
  const locked = disabled || send.pending;
  const attachments = draft.attachmentFileIds.map((fileId) => files.find((file) => file.id === fileId) ?? { id: fileId, name: fileId });
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = composerRef ?? internalRef;
  useEffect(() => {
    // The node is captured now: React detaches the ref before this cleanup runs.
    const node = ref.current;
    return () => {
      if (node && spaceId) onLeave(spaceId, node.value);
    };
  }, [ref, spaceId, onLeave]);

  const insert = (text: string) => {
    const node = ref.current;
    if (!node || locked) return;
    const start = node.selectionStart;
    const end = node.selectionEnd;
    const before = node.value.slice(0, start);
    const after = node.value.slice(end);
    node.value = `${before}${text} ${after}`;
    if (spaceId) noteTyping(spaceId, node.value);
    const caret = before.length + text.length + 1;
    node.setSelectionRange(caret, caret);
    node.focus();
  };

  return (
    <form onSubmit={onSubmit} onInput={() => { if (spaceId && ref.current) noteTyping(spaceId, ref.current.value); }} data-space-id={spaceId ?? undefined} style={{ padding: 14, paddingTop: 4, flexShrink: 0 }}>
      <div style={{ border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--panel)", padding: "10px 12px" }}>
        <MentionTextarea
          name="message"
          defaultValue={draft.body}
          rows={2}
          disabled={locked}
          ariaLabel={t("Message")}
          agents={agents}
          employees={employees}
          textareaRef={ref}
          style={{ minHeight: 38, maxHeight: "40vh", resize: "vertical" }}
        />
        <div className="row" style={{ paddingTop: 6, borderTop: "1px solid var(--border-soft)", gap: 4 }}>
          <IconButton icon="attach" label={t("Attach file")} onClick={onAttach} disabled={locked} />
          <IconButton icon="sparkle" label={t("Commands")} onClick={() => setSlashOpen((open) => !open)} disabled={locked} />
          {attachments.map((attachment) => (
            <span key={attachment.id} className="pill" style={{ maxWidth: 220 }}>
              <Icon name="file" size={14} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</span>
              <button
                type="button"
                aria-label={t("Remove {name}", { name: attachment.name })}
                disabled={locked}
                onClick={() => onAttachmentRemove(attachment.id)}
                style={{ display: "inline-flex", border: 0, background: "transparent", padding: 0, color: "var(--text-3)", cursor: "pointer" }}
              >
                <Icon name="x" size={14} />
              </button>
            </span>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{shortcutLabel("Enter")}</span>
            <Button tone="primary" size="small" type="submit" disabled={locked}><Icon name="send" size={12} /> {t("Send")}</Button>
          </div>
        </div>
        {send.error && <div className="form-error" role="alert">{t("Not sent: {reason}", { reason: send.error })}</div>}
        {attachError && <div className="form-error" role="alert">{t("Not attached: {reason}", { reason: attachError })}</div>}
        {slashOpen && !locked && (
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {SLASH_COMMANDS.map((command) => (
              <button
                key={command}
                type="button"
                className="pill"
                onClick={() => { insert(command); setSlashOpen(false); }}
              >
                {command}
              </button>
            ))}
          </div>
        )}
      </div>
    </form>
  );
}
