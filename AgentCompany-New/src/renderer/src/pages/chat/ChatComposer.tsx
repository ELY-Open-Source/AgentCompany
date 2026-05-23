import { useState, type FormEvent, type MutableRefObject } from "react";
import { Button, Icon, IconButton } from "../../shared/ui";
import type { FileObjectRecord } from "../../../../shared/domain";
import { SLASH_COMMANDS } from "./chat-helpers";

export function ChatComposer({
  disabled,
  files,
  attachmentFileId,
  onAttachmentChange,
  onSubmit,
  composerRef,
}: {
  disabled: boolean;
  files: FileObjectRecord[];
  attachmentFileId: string;
  onAttachmentChange: (next: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  composerRef: MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const [slashOpen, setSlashOpen] = useState(false);

  const insert = (text: string) => {
    const node = composerRef.current;
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
        <textarea
          ref={composerRef}
          name="message"
          rows={2}
          disabled={disabled}
          aria-label="Message"
          style={{
            width: "100%",
            border: 0,
            resize: "none",
            outline: "none",
            fontSize: 13,
            color: "var(--text-1)",
            background: "transparent",
            padding: 0,
            minHeight: 38,
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="row" style={{ paddingTop: 6, borderTop: "1px solid var(--border-soft)", gap: 4 }}>
          <IconButton icon="attach" label="Attach" />
          <select
            className="input"
            value={attachmentFileId}
            onChange={(event) => onAttachmentChange(event.target.value)}
            aria-label="File attachment"
            style={{ maxWidth: 180, padding: "4px 8px", height: 28, fontSize: 12 }}
            disabled={disabled}
          >
            <option value="">No attachment</option>
            {files.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
          </select>
          <IconButton icon="sparkle" label="Commands" onClick={() => setSlashOpen((open) => !open)} />
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>⌘↵</span>
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
