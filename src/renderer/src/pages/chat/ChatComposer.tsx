import { useRef, useState, type FormEvent, type MutableRefObject } from "react";
import { Button, Icon, IconButton } from "../../shared/ui";
import type { AgentRecord, EmployeeRecord, FileObjectRecord } from "../../../../shared/domain";
import { SLASH_COMMANDS } from "./chat-helpers";
import { MentionTextarea } from "./MentionTextarea";

export function ChatComposer({
  disabled,
  files,
  agents,
  employees,
  attachmentFileId,
  onAttachmentChange,
  onAttach,
  onSubmit,
  composerRef,
}: {
  disabled: boolean;
  files: FileObjectRecord[];
  agents: AgentRecord[];
  employees: EmployeeRecord[];
  attachmentFileId: string;
  onAttachmentChange: (next: string) => void;
  onAttach: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  composerRef: MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const [slashOpen, setSlashOpen] = useState(false);
  const attachment = files.find((file) => file.id === attachmentFileId) ?? null;
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = composerRef ?? internalRef;

  const insert = (text: string) => {
    const node = ref.current;
    if (!node) return;
    const start = node.selectionStart;
    const end = node.selectionEnd;
    const before = node.value.slice(0, start);
    const after = node.value.slice(end);
    node.value = `${before}${text} ${after}`;
    const caret = before.length + text.length + 1;
    node.setSelectionRange(caret, caret);
    node.focus();
  };

  return (
    <form onSubmit={onSubmit} style={{ padding: 14, paddingTop: 4, flexShrink: 0 }}>
      <div style={{ border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--panel)", padding: "10px 12px" }}>
        <MentionTextarea
          name="message"
          rows={2}
          disabled={disabled}
          ariaLabel="Message"
          agents={agents}
          employees={employees}
          textareaRef={ref}
          style={{ minHeight: 38 }}
        />
        <div className="row" style={{ paddingTop: 6, borderTop: "1px solid var(--border-soft)", gap: 4 }}>
          <IconButton icon="attach" label="Attach file" onClick={onAttach} disabled={disabled} />
          <IconButton icon="sparkle" label="Commands" onClick={() => setSlashOpen((open) => !open)} />
          {attachment && (
            <span className="pill" style={{ maxWidth: 220 }}>
              <Icon name="file" size={14} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</span>
              <button
                type="button"
                aria-label="Remove attachment"
                onClick={() => onAttachmentChange("")}
                style={{ display: "inline-flex", border: 0, background: "transparent", padding: 0, color: "var(--text-3)", cursor: "pointer" }}
              >
                <Icon name="x" size={14} />
              </button>
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>Ctrl+Enter</span>
            <Button tone="primary" size="small" type="submit" disabled={disabled}><Icon name="send" size={12} /> Send</Button>
          </div>
        </div>
        {slashOpen && (
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
