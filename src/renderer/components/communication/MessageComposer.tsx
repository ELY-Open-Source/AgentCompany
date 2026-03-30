import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowBendUpLeft, PaperPlaneTilt, X, ChatCircle } from "@phosphor-icons/react"
import type { AgentMessageRecord, AgentRecord, MessageChannel } from "@shared/types"
import { unwrap } from "../../lib/desktop"
import { InlineNotice } from "../ui"
import { AgentAvatar } from "./MessageItem"
import { useT } from "../../i18n"

function SendButton({ sending, disabled, onClick, label }: { sending: boolean; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || sending} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:brightness-90 active:translate-y-px disabled:opacity-40 disabled:pointer-events-none" aria-label={label}>
      {sending ? <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" /><path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg> : <PaperPlaneTilt size={18} weight="fill" />}
    </button>
  )
}

interface MessageComposerProps {
  agents: AgentRecord[]; companyId: string; channel: MessageChannel; channelTargetId: string | null
  directParticipantIds?: string[]; replyTo: AgentMessageRecord | null; onSent: () => void; onCancelReply: () => void
}

export function MessageComposer({ agents, companyId, channel, channelTargetId, directParticipantIds = [], replyTo, onSent, onCancelReply }: MessageComposerProps) {
  const [fromAgentId, setFromAgentId] = useState(agents[0]?.id ?? "")
  const [body, setBody] = useState(""); const [subject, setSubject] = useState("")
  const [sending, setSending] = useState(false); const [sendError, setSendError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (replyTo) textareaRef.current?.focus() }, [replyTo])
  useEffect(() => { if (agents.length === 0) { if (fromAgentId) setFromAgentId(""); return }; if (!agents.some((a) => a.id === fromAgentId)) setFromAgentId(agents[0]?.id ?? "") }, [agents, fromAgentId])

  const directRecipientId = useMemo(() => {
    if (channel !== "direct") return null
    if (replyTo?.fromAgentId) return replyTo.fromAgentId
    if (directParticipantIds.length === 0) return null
    if (directParticipantIds.length === 1) return directParticipantIds[0] ?? null
    if (fromAgentId && directParticipantIds.includes(fromAgentId)) return directParticipantIds.find((id) => id !== fromAgentId) ?? null
    return directParticipantIds[0] ?? null
  }, [channel, replyTo, directParticipantIds, fromAgentId])

  const handleSend = useCallback(async () => {
    if (!body.trim() || !fromAgentId) return; if (channel === "direct" && !directRecipientId) return
    if (!agents.some((a) => a.id === fromAgentId)) { setSendError("Select a valid sender."); return }
    setSending(true); setSendError(null)
    try { unwrap(await window.agentCompany.sendAgentMessage({ companyId, fromAgentId, toAgentId: channel === "direct" ? directRecipientId : null, channel, channelTargetId, subject: subject.trim() || (replyTo ? `Re: ${replyTo.subject}` : ""), body: body.trim(), priority: "normal", parentMessageId: replyTo?.id ?? null, attachmentsJson: "[]" })); setBody(""); setSubject(""); onSent() } catch (e) { setSendError(e instanceof Error ? e.message : "Failed to send message.") } finally { setSending(false) }
  }, [agents, body, channel, channelTargetId, companyId, directRecipientId, fromAgentId, onSent, replyTo, subject])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleSend() } }, [handleSend])
  const fromAgent = agents.find((a) => a.id === fromAgentId)

  return (
    <div className="border-t border-border bg-card px-4 py-3">
      {sendError ? <div className="mb-3"><InlineNotice message={sendError} /></div> : null}
      {channel === "direct" && !directRecipientId ? <div className="mb-2"><InlineNotice message="Select a direct conversation partner before sending a DM." /></div> : null}
      <AnimatePresence>
        {replyTo ? (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-2 flex items-center gap-2 overflow-hidden rounded-lg bg-muted px-3 py-2">
            <ArrowBendUpLeft size={12} className="text-primary" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">Replying to <span className="font-semibold">{agents.find((a) => a.id === replyTo.fromAgentId)?.name ?? "agent"}</span>{replyTo.subject ? `: ${replyTo.subject}` : ""}</span>
            <button type="button" onClick={onCancelReply} className="shrink-0 rounded-[4px] p-0.5 text-muted-foreground transition hover:text-foreground"><X size={12} /></button>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="mb-2 flex items-center gap-2">
        <AgentAvatar agent={fromAgent} size="sm" />
        <select value={fromAgentId} onChange={(e) => setFromAgentId(e.target.value)} className="min-w-0 rounded-lg border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground">
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
        </select>
        {!replyTo ? <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (optional)" aria-label="Message subject" className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] text-foreground placeholder:text-muted-foreground" /> : null}
      </div>
      <div className="flex items-end gap-2">
        <textarea ref={textareaRef} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={handleKeyDown} placeholder="Type a message..." aria-label="Message body" rows={2} className="min-h-[40px] min-w-0 flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-transparent focus:outline-none focus:ring-2" style={{ focusRingColor: "var(--primary)" } as React.CSSProperties} />
        <SendButton sending={sending} disabled={!body.trim() || !fromAgentId || (channel === "direct" && !directRecipientId)} onClick={() => void handleSend()} label="Send message" />
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">Press {navigator.platform.includes("Mac") ? "Cmd" : "Ctrl"}+Enter to send</div>
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
      {sendError ? <div className="mb-3"><InlineNotice message={sendError} /></div> : null}
      <div className="flex items-end gap-2">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Reply in task discussion..." aria-label="Task discussion reply" rows={2} className="min-h-[40px] min-w-0 flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-transparent focus:outline-none focus:ring-2" style={{ focusRingColor: "var(--primary)" } as React.CSSProperties} />
        <SendButton sending={sending} disabled={!body.trim()} onClick={() => void handleSend()} label="Send task comment" />
      </div>
    </div>
  )
}

export function NoChannelComposer() {
  const t = useT()
  return <div className="border-t border-border bg-card px-4 py-2.5"><div className="flex items-center gap-2 text-[11px] text-muted-foreground"><ChatCircle size={14} /><span>{t("comm.selectChannelSend")}</span></div></div>
}
