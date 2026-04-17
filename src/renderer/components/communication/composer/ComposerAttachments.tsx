import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Paperclip, X } from "../../ui/icons";
import type { DocumentRecord } from "@shared/types";
import { useT } from "../../../i18n";

export interface AttachmentItem {
  type: string;
  id: string;
  title: string;
}

interface ComposerAttachmentsProps {
  documents: DocumentRecord[];
  attachments: AttachmentItem[];
  onAdd: (doc: DocumentRecord) => void;
  onRemove: (id: string) => void;
}

export function ComposerAttachments({
  documents,
  attachments,
  onAdd,
  onRemove,
}: ComposerAttachmentsProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const attachedIds = useMemo(() => new Set(attachments.map((a) => a.id)), [attachments]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return documents.filter(
      (d) =>
        !attachedIds.has(d.id) &&
        (d.title.toLowerCase().includes(q) || d.type.toLowerCase().includes(q)),
    );
  }, [documents, attachedIds, filter]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
        aria-label={t("composer.attachDocument")}
      >
        <Paperclip size={16} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-72 rounded-xl border border-border bg-card shadow-xl">
          <div className="border-b border-border px-3 py-2">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("composer.searchDocuments")}
              className="w-full rounded-lg border border-border bg-muted px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12px] text-muted-foreground">
                {documents.length === 0
                  ? t("composer.noDocuments")
                  : t("composer.noMatchingDocuments")}
              </div>
            ) : (
              filtered.slice(0, 20).map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => {
                    onAdd(doc);
                    setFilter("");
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-muted"
                >
                  <FileText size={14} className="shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-foreground">
                      {doc.title}
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {doc.type.replaceAll("_", " ")} · {doc.status}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="absolute bottom-full left-10 mb-1 flex flex-wrap gap-1">
          {attachments.map((att) => (
            <span
              key={att.id}
              className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary"
            >
              <FileText size={10} />
              <span className="max-w-[120px] truncate">{att.title}</span>
              <button
                type="button"
                onClick={() => onRemove(att.id)}
                className="ml-0.5 rounded-sm p-0.5 transition hover:bg-primary/20"
              >
                <X size={8} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: AttachmentItem[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {attachments.map((att) => (
        <span
          key={att.id}
          className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary"
        >
          <FileText size={10} />
          <span className="max-w-[160px] truncate">{att.title}</span>
          <button
            type="button"
            onClick={() => onRemove(att.id)}
            className="ml-0.5 rounded-sm p-0.5 transition hover:bg-primary/20"
          >
            <X size={8} />
          </button>
        </span>
      ))}
    </div>
  );
}
