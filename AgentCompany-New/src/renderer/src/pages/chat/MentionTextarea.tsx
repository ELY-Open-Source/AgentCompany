import { useRef, useState, type MutableRefObject } from "react";
import { Avatar } from "../../shared/ui";
import type { AgentRecord, EmployeeRecord } from "../../../../shared/domain";

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

export function MentionTextarea({
  name,
  rows,
  disabled,
  ariaLabel,
  agents,
  employees,
  textareaRef,
  style,
}: {
  name: string;
  rows: number;
  disabled?: boolean;
  ariaLabel: string;
  agents: AgentRecord[];
  employees: EmployeeRecord[];
  textareaRef?: MutableRefObject<HTMLTextAreaElement | null>;
  style?: React.CSSProperties;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const anchor = useRef(0);
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = textareaRef ?? innerRef;
  const candidates = buildCandidates(agents, employees);
  const filtered = query !== null
    ? candidates.filter((c) => c.handle.toLowerCase().includes(query.toLowerCase()))
    : [];

  const close = () => setQuery(null);

  const insertMention = (handle: string) => {
    const node = ref.current;
    if (!node) return;
    const before = node.value.slice(0, anchor.current);
    const after = node.value.slice(node.selectionStart);
    node.value = `${before}@${handle} ${after}`;
    const caret = before.length + handle.length + 2;
    node.setSelectionRange(caret, caret);
    node.focus();
    close();
  };

  const handleInput = () => {
    const node = ref.current;
    if (!node) return;
    const pos = node.selectionStart;
    const text = node.value.slice(0, pos);
    const atMatch = text.match(/(^|\s)@(\S*)$/);
    if (atMatch) {
      anchor.current = pos - atMatch[2].length - 1;
      setQuery(atMatch[2]);
      setIndex(0);
    } else {
      close();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (query !== null && filtered.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((i) => (i + 1) % filtered.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertMention(filtered[index].handle);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <div style={{ position: "relative" }}>
      {query !== null && filtered.length > 0 && (
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
                background: i === index ? "var(--accent-soft)" : "transparent",
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
        ref={ref}
        name={name}
        rows={rows}
        disabled={disabled}
        aria-label={ariaLabel}
        style={{
          width: "100%",
          border: 0,
          resize: "none",
          outline: "none",
          fontSize: 13,
          color: "var(--text-1)",
          background: "transparent",
          padding: 0,
          ...style,
        }}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(close, 200)}
      />
    </div>
  );
}
