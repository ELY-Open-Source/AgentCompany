import { useEffect, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import { Avatar, Button, Icon, IconButton } from "../../shared/ui";
import type { AgentRecord, EmployeeRecord, FileObjectRecord } from "../../../../shared/domain";
import { SLASH_COMMANDS } from "./chat-helpers";

interface MentionCandidate {
  handle: string;
  label: string;
  bot: boolean;
}

function buildCandidates(agents: AgentRecord[], employees: EmployeeRecord[]): MentionCandidate[] {
  return [
    ...agents.map((a) => ({ handle: a.name, label: `${a.name} · ${a.role}`, bot: true })),
    ...employees.map((e) => ({ handle: e.displayName, label: `${e.displayName} · ${e.role}`, bot: false })),
  ];
}

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
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionAnchor = useRef(0);
  const attachment = files.find((file) => file.id === attachmentFileId) ?? null;
  const candidates = buildCandidates(agents, employees);
  const filtered = mentionQuery !== null
    ? candidates.filter((c) => c.handle.toLowerCase().includes(mentionQuery.toLowerCase()))
    : [];

  useEffect(() => { setMentionIndex(0); }, [mentionQuery]);

  const closeMention = () => setMentionQuery(null);

  const insertMention = (handle: string) => {
    const node = composerRef.current;
    if (!node) return;
    const before = node.value.slice(0, mentionAnchor.current);
    const after = node.value.slice(node.selectionStart);
    node.value = `${before}@${handle} ${after}`;
    const caret = before.length + handle.length + 2;
    node.setSelectionRange(caret, caret);
    node.focus();
    closeMention();
  };

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

  const handleInput = () => {
    const node = composerRef.current;
    if (!node) return;
    const pos = node.selectionStart;
    const text = node.value.slice(0, pos);
    const atMatch = text.match(/(^|\s)@(\S*)$/);
    if (atMatch) {
      mentionAnchor.current = pos - atMatch[2].length - 1;
      setMentionQuery(atMatch[2]);
    } else {
      closeMention();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && filtered.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((i) => (i + 1) % filtered.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertMention(filtered[mentionIndex].handle);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeMention();
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <form onSubmit={onSubmit} style={{ padding: 14, paddingTop: 4, flexShrink: 0 }}>
      <div style={{ border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--panel)", padding: "10px 12px", position: "relative" }}>
        {mentionQuery !== null && filtered.length > 0 && (
          <div style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            right: 0,
            marginBottom: 4,
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            maxHeight: 200,
            overflow: "auto",
            zIndex: 10,
          }}>
            {filtered.map((c, i) => (
              <button
                key={c.handle}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); insertMention(c.handle); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "8px 12px",
                  border: 0,
                  background: i === mentionIndex ? "var(--accent-soft)" : "transparent",
                  cursor: "pointer",
                  fontSize: 13,
                  color: "var(--text-1)",
                  textAlign: "left",
                }}
              >
                <Avatar name={c.handle} size="sm" bot={c.bot} />
                <span style={{ fontWeight: 500 }}>{c.label}</span>
              </button>
            ))}
          </div>
        )}
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
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(closeMention, 200)}
        />
        <div className="row" style={{ paddingTop: 6, borderTop: "1px solid var(--border-soft)", gap: 4 }}>
          <IconButton icon="attach" label="Attach file" onClick={onAttach} disabled={disabled} />
          <IconButton icon="sparkle" label="Commands" onClick={() => setSlashOpen((open) => !open)} />
          {attachment && (
            <span className="pill" style={{ maxWidth: 220 }}>
              <Icon name="file" size={11} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</span>
              <button
                type="button"
                aria-label="Remove attachment"
                onClick={() => onAttachmentChange("")}
                style={{ display: "inline-flex", border: 0, background: "transparent", padding: 0, color: "var(--text-3)", cursor: "pointer" }}
              >
                <Icon name="x" size={11} />
              </button>
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>Ctrl+Enter</span>
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
