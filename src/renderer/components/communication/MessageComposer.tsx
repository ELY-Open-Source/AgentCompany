import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowBendUpLeft, X, ChatCircle, UserCircle, Paperclip, FileText } from "@phosphor-icons/react"
import type { AgentMessageRecord, AgentRecord, DocumentRecord, MessageChannel } from "@shared/types"
import { unwrap } from "../../lib/desktop"
import { cmdOrCtrlLabel } from "../../lib/platform"
import { getAgentInitials } from "../../lib/formatters"
import { useAppStore } from "../../state/store"
import { InlineNotice } from "../ui"
import { useT } from "../../i18n"
import { ComposerShell } from "./composer-shell/ComposerShell"

const HUMAN_SENDER_ID = "__board__";

// ─── Attachment Picker ──────────────────────────────────────────────────────

interface AttachmentItem { type: string; id: string; title: string }

function AttachmentPicker({ documents, attachments, onAdd, onRemove }: {
  documents: DocumentRecord[];
  attachments: AttachmentItem[];
  onAdd: (doc: DocumentRecord) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)
  const attachedIds = useMemo(() => new Set(attachments.map((a) => a.id)), [attachments])

  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    return documents.filter((d) => !attachedIds.has(d.id) && (d.title.toLowerCase().includes(q) || d.type.toLowerCase().includes(q)))
  }, [documents, attachedIds, filter])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
        aria-label="Attach document"
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
              placeholder="Search documents..."
              className="w-full rounded-lg border border-border bg-muted px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12px] text-muted-foreground">
                {documents.length === 0 ? "No documents in this company" : "No matching documents"}
              </div>
            ) : (
              filtered.slice(0, 20).map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => { onAdd(doc); setFilter(""); setOpen(false) }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-muted"
                >
                  <FileText size={14} className="shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-foreground">{doc.title}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{doc.type.replaceAll("_", " ")} · {doc.status}</div>
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
            <span key={att.id} className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
              <FileText size={10} />
              <span className="max-w-[120px] truncate">{att.title}</span>
              <button type="button" onClick={() => onRemove(att.id)} className="ml-0.5 rounded-sm p-0.5 transition hover:bg-primary/20"><X size={8} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── @Mention Autocomplete ──────────────────────────────────────────────────

/**
 * Compute pixel coordinates of the caret inside a textarea relative to the
 * textarea's own top-left corner. Uses a hidden mirror div that replicates
 * the textarea's type/font metrics so the span we drop at the caret offset
 * lays out in the same position the real caret does.
 */
function getTextareaCaretCoords(textarea: HTMLTextAreaElement, caretIndex: number): { top: number; left: number } {
  const style = window.getComputedStyle(textarea)
  const mirror = document.createElement("div")
  const mirrorStyle = mirror.style

  const copyProps = [
    "boxSizing", "width", "height", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant", "lineHeight",
    "letterSpacing", "wordSpacing", "textTransform", "textIndent", "whiteSpace", "wordWrap",
  ] as const
  for (const prop of copyProps) {
    mirrorStyle[prop as never] = style[prop as never]
  }
  mirrorStyle.position = "absolute"
  mirrorStyle.visibility = "hidden"
  mirrorStyle.overflow = "hidden"
  mirrorStyle.whiteSpace = "pre-wrap"
  mirrorStyle.wordWrap = "break-word"
  mirrorStyle.top = "0"
  mirrorStyle.left = "-9999px"

  mirror.textContent = textarea.value.slice(0, caretIndex)
  const marker = document.createElement("span")
  marker.textContent = "\u200b"
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const coords = { top: marker.offsetTop - textarea.scrollTop, left: marker.offsetLeft - textarea.scrollLeft }
  document.body.removeChild(mirror)
  return coords
}

function MentionDropdown({ agents, query, onSelect, position }: {
  agents: AgentRecord[];
  query: string;
  onSelect: (agent: AgentRecord | null) => void;
  position: { top: number; left: number };
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return agents.filter((a) => a.status !== "terminated" && (
      a.name.toLowerCase().includes(q) ||
      (a.title?.toLowerCase().includes(q)) ||
      (a.department?.toLowerCase().includes(q))
    )).slice(0, 8)
  }, [agents, query])

  useEffect(() => { setSelectedIndex(0) }, [query])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)) }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)) }
      else if (e.key === "Enter" || e.key === "Tab") {
        if (filtered[selectedIndex]) { e.preventDefault(); onSelect(filtered[selectedIndex]) }
      }
      else if (e.key === "Escape") { onSelect(null) }
    }
    document.addEventListener("keydown", handler, true)
    return () => document.removeEventListener("keydown", handler, true)
  }, [filtered, selectedIndex, onSelect])

  if (filtered.length === 0) return null

  return (
    <div
      className="absolute z-50 w-64 rounded-xl border border-border bg-card shadow-xl"
      style={{ top: position.top, left: position.left }}
    >
      {filtered.map((agent, i) => (
        <button
          key={agent.id}
          type="button"
          onClick={() => onSelect(agent)}
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition ${
            i === selectedIndex ? "bg-primary/10" : "hover:bg-muted"
          } ${i === 0 ? "rounded-t-xl" : ""} ${i === filtered.length - 1 ? "rounded-b-xl" : ""}`}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
            {getAgentInitials(agent.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-foreground">{agent.name}</div>
            <div className="truncate text-[10px] text-muted-foreground">{agent.title}{agent.department ? ` · ${agent.department}` : ""}</div>
          </div>
        </button>
      ))}
    </div>
  )
}

// ─── Main Composer ──────────────────────────────────────────────────────────

interface MessageComposerProps {
  agents: AgentRecord[]; companyId: string; channel: MessageChannel; channelTargetId: string | null
  directParticipantIds?: string[]; replyTo: AgentMessageRecord | null; onSent: () => void; onCancelReply: () => void
  documents?: DocumentRecord[]
  /** Thread ID for precise checkpoint resolution. */
  threadId?: string | null
  /** Wait state ID for precise checkpoint resolution. */
  waitStateId?: string | null
}

export function MessageComposer({ agents, companyId, channel, channelTargetId, directParticipantIds = [], replyTo, onSent, onCancelReply, documents = [], threadId = null, waitStateId = null }: MessageComposerProps) {
  const [body, setBody] = useState(""); const [subject, setSubject] = useState("")
  const [sending, setSending] = useState(false); const [sendError, setSendError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [mentionState, setMentionState] = useState<{ active: boolean; query: string; startIndex: number; caretTop: number; caretLeft: number }>({ active: false, query: "", startIndex: -1, caretTop: 0, caretLeft: 0 })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const addToast = useAppStore((s) => s.addToast)

  useEffect(() => { if (replyTo) textareaRef.current?.focus() }, [replyTo])

  const directRecipientId = useMemo(() => {
    if (channel !== "direct") return null
    if (replyTo?.fromAgentId) return replyTo.fromAgentId
    if (directParticipantIds.length === 0) return null
    const nonBoardParticipant = directParticipantIds.find((id) => id !== HUMAN_SENDER_ID)
    return nonBoardParticipant ?? directParticipantIds[0] ?? null
  }, [channel, replyTo, directParticipantIds])

  const handleAddAttachment = useCallback((doc: DocumentRecord) => {
    setAttachments((prev) => [...prev, { type: "document", id: doc.id, title: doc.title }])
  }, [])

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const handleMentionSelect = useCallback((agent: AgentRecord | null) => {
    if (!agent) { setMentionState((s) => ({ ...s, active: false, query: "", startIndex: -1 })); return }
    setBody((prev) => {
      const before = prev.slice(0, mentionState.startIndex)
      const after = prev.slice(mentionState.startIndex + mentionState.query.length + 1)
      return `${before}@${agent.name} ${after}`
    })
    setMentionState((s) => ({ ...s, active: false, query: "", startIndex: -1 }))
    textareaRef.current?.focus()
  }, [mentionState])

  const handleBodyChange = useCallback((value: string, e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setBody(value)

    const cursorPos = e.target.selectionStart
    const windowStart = Math.max(0, cursorPos - 50)
    const windowText = value.slice(windowStart, cursorPos)
    const match = windowText.match(/(?:^|\s)@(\w*)$/)
    if (match) {
      const query = match[1]
      const atIndex = windowStart + match.index! + (match[0].startsWith("@") ? 0 : 1)
      const coords = getTextareaCaretCoords(e.target, atIndex)
      const style = window.getComputedStyle(e.target)
      const lineHeightPx = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3
      setMentionState({
        active: true,
        query,
        startIndex: atIndex,
        caretTop: coords.top + lineHeightPx,
        caretLeft: coords.left,
      })
      return
    }
    setMentionState((s) => ({ ...s, active: false, query: "", startIndex: -1 }))
  }, [])

  const handleSend = useCallback(async () => {
    if (!body.trim()) return; if (channel === "direct" && !directRecipientId) return
    setSending(true); setSendError(null)
    const attachmentsJson = attachments.length > 0 ? JSON.stringify(attachments) : "[]"
    try {
      const result = unwrap(await window.agentCompany.sendAgentMessage({
        companyId, fromAgentId: HUMAN_SENDER_ID,
        toAgentId: channel === "direct" ? directRecipientId : null,
        channel, channelTargetId,
        subject: subject.trim() || (replyTo ? `Re: ${replyTo.subject}` : ""),
        body: body.trim(), priority: "normal",
        parentMessageId: replyTo?.id ?? null, attachmentsJson,
        threadId: threadId ?? undefined,
        waitStateId: waitStateId ?? undefined,
      }))
      if (result.mentionResults && result.mentionResults.length > 0) {
        const woken = result.mentionResults.filter((m) => m.outcome === "woken")
        const queued = result.mentionResults.filter((m) => m.outcome === "queued")
        const busy = result.mentionResults.filter((m) => m.outcome === "busy")
        if (woken.length > 0) addToast(`Notified: ${woken.map((m) => m.agentName).join(", ")}`, "success")
        if (queued.length > 0) addToast(`Queued: ${queued.map((m) => m.agentName).join(", ")}`, "warn")
        if (busy.length > 0) addToast(`Busy: ${busy.map((m) => m.agentName).join(", ")}`, "warn")
      }
      setBody(""); setSubject(""); setAttachments([]); onSent()
    } catch (e) { setSendError(e instanceof Error ? e.message : "Failed to send message.") }
    finally { setSending(false) }
  }, [body, channel, channelTargetId, companyId, directRecipientId, onSent, replyTo, subject, attachments, threadId, waitStateId, addToast])

  const handleKeyDownExtra = useCallback(() => {
    return mentionState.active // when mention active, ComposerShell should skip its own Enter handler
  }, [mentionState.active])

  const directMissingNotice = channel === "direct" && !directRecipientId
    ? <div className="mb-2"><InlineNotice message="Select a direct conversation partner before sending a DM." /></div>
    : null

  const replyBanner = (
    <AnimatePresence>
      {replyTo ? (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-2 flex items-center gap-2 overflow-hidden rounded-lg bg-muted px-3 py-2">
          <ArrowBendUpLeft size={12} className="text-primary" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">Replying to <span className="font-semibold">{agents.find((a) => a.id === replyTo.fromAgentId)?.name ?? "agent"}</span>{replyTo.subject ? `: ${replyTo.subject}` : ""}</span>
          <button type="button" onClick={onCancelReply} className="shrink-0 rounded-[4px] p-0.5 text-muted-foreground transition hover:text-foreground"><X size={12} /></button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )

  const subjectRow = (
    <div className="mb-2 flex items-center gap-2">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"><UserCircle size={16} weight="fill" /></div>
      <span className="text-[11px] font-medium text-foreground">You (Board)</span>
      {!replyTo ? <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (optional)" aria-label="Message subject" className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] text-foreground placeholder:text-muted-foreground" /> : null}
    </div>
  )

  const attachmentsRow = attachments.length > 0 ? (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {attachments.map((att) => (
        <span key={att.id} className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
          <FileText size={10} />
          <span className="max-w-[160px] truncate">{att.title}</span>
          <button type="button" onClick={() => handleRemoveAttachment(att.id)} className="ml-0.5 rounded-sm p-0.5 transition hover:bg-primary/20"><X size={8} /></button>
        </span>
      ))}
    </div>
  ) : null

  return (
    <div className="relative border-t border-border bg-card px-4 py-3">
      {directMissingNotice}
      <ComposerShell
        ref={textareaRef}
        value={body}
        onChange={handleBodyChange}
        onSend={() => void handleSend()}
        placeholder="Type a message... (use @ to mention agents)"
        sending={sending}
        error={sendError}
        shortcutHint={`Press ${cmdOrCtrlLabel()}+Enter to send`}
        sendLabel="Send message"
        sendDisabled={!body.trim() || (channel === "direct" && !directRecipientId)}
        leading={<AttachmentPicker documents={documents} attachments={attachments} onAdd={handleAddAttachment} onRemove={handleRemoveAttachment} />}
        belowHeader={<>{replyBanner}{subjectRow}{attachmentsRow}</>}
        onKeyDownExtra={handleKeyDownExtra}
        textareaAriaLabel="Message body"
      />

      {mentionState.active && textareaRef.current ? (
        <MentionDropdown
          agents={agents}
          query={mentionState.query}
          onSelect={handleMentionSelect}
          position={{
            top: textareaRef.current.offsetTop + mentionState.caretTop,
            left: textareaRef.current.offsetLeft + mentionState.caretLeft,
          }}
        />
      ) : null}
    </div>
  )
}

export function TaskDiscussionComposer({ companyId, taskId, onSent }: { companyId: string; taskId: string; onSent: () => void }) {
  const [body, setBody] = useState(""); const [sending, setSending] = useState(false); const [sendError, setSendError] = useState<string | null>(null)
  const handleSend = useCallback(async () => {
    if (!body.trim()) return; setSending(true); setSendError(null)
    try { unwrap(await window.agentCompany.addComment({ companyId, taskId, authorName: "Board", body: body.trim() })); setBody(""); onSent() } catch (e) { setSendError(e instanceof Error ? e.message : "Failed to send.") } finally { setSending(false) }
  }, [body, companyId, taskId, onSent])
  return (
    <div className="border-t border-border bg-card px-4 py-3">
      <ComposerShell
        value={body}
        onChange={(v) => setBody(v)}
        onSend={() => void handleSend()}
        placeholder="Reply in task discussion..."
        sending={sending}
        error={sendError}
        sendLabel="Send task comment"
        textareaAriaLabel="Task discussion reply"
      />
    </div>
  )
}

export function NoChannelComposer() {
  const t = useT()
  return <div className="border-t border-border bg-card px-4 py-2.5"><div className="flex items-center gap-2 text-[11px] text-muted-foreground"><ChatCircle size={14} /><span>{t("comm.selectChannelSend")}</span></div></div>
}
