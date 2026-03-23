import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowBendUpLeft, PaperPlaneTilt, X, ChatCircle } from "@phosphor-icons/react"
import type { AgentMessageRecord, AgentRecord, MessageChannel, MessagePriority, ProjectRecord } from "@shared/types"
import { unwrap } from "../../lib/desktop"
import { InlineNotice, Modal, Select, Input, TextArea } from "../ui"
import { AgentAvatar } from "./MessageItem"
import { useT } from "../../i18n"

function SendButton({ sending, disabled, onClick, label }: { sending: boolean; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || sending} className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[8px] bg-[color:var(--accent)] text-[color:var(--text-on-accent)] transition hover:brightness-90 active:translate-y-px disabled:opacity-40 disabled:pointer-events-none" aria-label={label}>
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
    <div className="border-t border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3">
      {sendError ? <div className="mb-3"><InlineNotice message={sendError} /></div> : null}
      {channel === "direct" && !directRecipientId ? <div className="mb-2"><InlineNotice message="Select a direct conversation partner before sending a DM." /></div> : null}
      <AnimatePresence>
        {replyTo ? (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-2 flex items-center gap-2 overflow-hidden rounded-[6px] bg-[color:var(--panel-soft)] px-3 py-2">
            <ArrowBendUpLeft size={12} className="text-[color:var(--accent)]" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-[color:var(--muted-strong)]">Replying to <span className="font-semibold">{agents.find((a) => a.id === replyTo.fromAgentId)?.name ?? "agent"}</span>{replyTo.subject ? `: ${replyTo.subject}` : ""}</span>
            <button type="button" onClick={onCancelReply} className="shrink-0 rounded-[4px] p-0.5 text-[color:var(--muted)] transition hover:text-[color:var(--text)]"><X size={12} /></button>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="mb-2 flex items-center gap-2">
        <AgentAvatar agent={fromAgent} size="sm" />
        <select value={fromAgentId} onChange={(e) => setFromAgentId(e.target.value)} className="min-w-0 rounded-[6px] border border-[color:var(--line)] bg-[color:var(--panel)] px-2 py-1 text-[11px] font-medium text-[color:var(--text)]">
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
        </select>
        {!replyTo ? <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (optional)" className="min-w-0 flex-1 rounded-[6px] border border-[color:var(--line)] bg-[color:var(--panel)] px-2.5 py-1 text-[11px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]" /> : null}
      </div>
      <div className="flex items-end gap-2">
        <textarea ref={textareaRef} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={handleKeyDown} placeholder="Type a message..." rows={2} className="min-h-[40px] min-w-0 flex-1 resize-none rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-3 py-2 text-[13px] text-[color:var(--text)] placeholder:text-[color:var(--muted)] focus:border-transparent focus:outline-none focus:ring-2" style={{ focusRingColor: "var(--accent)" } as React.CSSProperties} />
        <SendButton sending={sending} disabled={!body.trim() || !fromAgentId || (channel === "direct" && !directRecipientId)} onClick={() => void handleSend()} label="Send message" />
      </div>
      <div className="mt-1 text-[11px] text-[color:var(--muted)]">Press {navigator.platform.includes("Mac") ? "Cmd" : "Ctrl"}+Enter to send</div>
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
    <div className="border-t border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3">
      {sendError ? <div className="mb-3"><InlineNotice message={sendError} /></div> : null}
      <div className="flex items-end gap-2">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Reply in task discussion..." rows={2} className="min-h-[40px] min-w-0 flex-1 resize-none rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-3 py-2 text-[13px] text-[color:var(--text)] placeholder:text-[color:var(--muted)] focus:border-transparent focus:outline-none focus:ring-2" style={{ focusRingColor: "var(--accent)" } as React.CSSProperties} />
        <SendButton sending={sending} disabled={!body.trim()} onClick={() => void handleSend()} label="Send task comment" />
      </div>
    </div>
  )
}

export function NoChannelComposer() {
  const t = useT()
  return <div className="border-t border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-2.5"><div className="flex items-center gap-2 text-[11px] text-[color:var(--muted)]"><ChatCircle size={14} /><span>{t("comm.selectChannelSend")}</span></div></div>
}

export function ComposeModal({ open, onClose, agents, projects, companyId, onSent }: { open: boolean; onClose: () => void; agents: AgentRecord[]; projects?: ProjectRecord[]; companyId: string; onSent: () => void }) {
  const t = useT()
  const [fromAgentId, setFromAgentId] = useState(agents[0]?.id ?? ""); const [toAgentId, setToAgentId] = useState(""); const [channel, setChannel] = useState<MessageChannel>("company")
  const [channelTargetId, setChannelTargetId] = useState(""); const [subject, setSubject] = useState(""); const [body, setBody] = useState("")
  const [priority, setPriority] = useState<MessagePriority>("normal"); const [sending, setSending] = useState(false); const [sendError, setSendError] = useState<string | null>(null)

  const deptOpts = useMemo(() => { const d = new Set<string>(); for (const a of agents) { if (a.department) d.add(a.department) }; return Array.from(d).sort() }, [agents])
  useEffect(() => { if (channel !== "direct") setToAgentId(""); if (channel !== "department" && channel !== "project") setChannelTargetId("") }, [channel])
  useEffect(() => { if (agents.length === 0) { if (fromAgentId) setFromAgentId(""); return }; if (!agents.some((a) => a.id === fromAgentId)) setFromAgentId(agents[0]?.id ?? "") }, [agents, fromAgentId])

  const handleSend = useCallback(async () => {
    const reqTarget = channel === "department" || channel === "project"
    if (!body.trim() || !fromAgentId || !subject.trim() || (channel === "direct" && !toAgentId) || (reqTarget && !channelTargetId)) return
    if (!agents.some((a) => a.id === fromAgentId)) { setSendError("Select a valid sender."); return }
    setSending(true); setSendError(null)
    try { unwrap(await window.agentCompany.sendAgentMessage({ companyId, fromAgentId, toAgentId: channel === "direct" && toAgentId ? toAgentId : null, channel, channelTargetId: reqTarget ? channelTargetId || null : null, subject: subject.trim(), body: body.trim(), priority, parentMessageId: null, attachmentsJson: "[]" })); setSubject(""); setBody(""); setPriority("normal"); onSent(); onClose() } catch (e) { setSendError(e instanceof Error ? e.message : "Failed to send.") } finally { setSending(false) }
  }, [agents, body, channel, channelTargetId, companyId, fromAgentId, onClose, onSent, priority, subject, toAgentId])

  return (
    <Modal open={open} title={t("comm.composeMessage")} onClose={onClose} width="560px">
      <div className="space-y-4">
        {sendError ? <InlineNotice message={sendError} /> : null}
        <Select label={t("comm.fromAgent")} value={fromAgentId} onChange={setFromAgentId} options={agents.map((a) => ({ value: a.id, label: `${a.name} (${a.role})` }))} />
        <Select label={t("comm.channel")} value={channel} onChange={(v) => setChannel(v as MessageChannel)} options={[{ value: "company", label: t("comm.companyBroadcast") }, { value: "department", label: t("comm.departmentChannel") }, { value: "project", label: t("comm.projectChannel") }, { value: "incident", label: t("comm.incidentChannel") }, { value: "direct", label: t("comm.directMessage") }]} />
        {channel === "direct" ? <Select label="To Agent" value={toAgentId} onChange={setToAgentId} options={[{ value: "", label: "Select a recipient..." }, ...agents.filter((a) => a.id !== fromAgentId).map((a) => ({ value: a.id, label: `${a.name} (${a.role})` }))]} />
        : channel === "department" ? <Select label="Department" value={channelTargetId} onChange={setChannelTargetId} options={[{ value: "", label: "Select department..." }, ...deptOpts.map((d) => ({ value: d, label: d.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()) }))]} />
        : channel === "project" ? <Select label="Project" value={channelTargetId} onChange={setChannelTargetId} options={[{ value: "", label: "Select project..." }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.name }))]} /> : null}
        <Input label={t("comm.subject")} value={subject} onChange={setSubject} placeholder={t("comm.messageSubject")} />
        <TextArea label={t("comm.message")} value={body} onChange={setBody} placeholder={t("comm.writeMessage")} rows={5} />
        <Select label="Priority" value={priority} onChange={(v) => setPriority(v as MessagePriority)} options={[{ value: "low", label: "Low" }, { value: "normal", label: "Normal" }, { value: "urgent", label: "Urgent" }]} />
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-[8px] px-3 py-2 text-[13px] font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)]">{t("common.cancel")}</button>
          <button type="button" onClick={() => void handleSend()} disabled={!body.trim() || !subject.trim() || !fromAgentId || (channel === "direct" && !toAgentId) || ((channel === "department" || channel === "project") && !channelTargetId) || sending} className="inline-flex items-center gap-2 rounded-[8px] px-3 py-2 text-[13px] font-semibold bg-[color:var(--accent)] text-[color:var(--text-on-accent)] transition hover:brightness-90 active:translate-y-px disabled:opacity-40 disabled:pointer-events-none">
            {sending ? <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" /><path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg> : <PaperPlaneTilt size={14} weight="fill" />}{t("comm.sendMessage")}
          </button>
        </div>
      </div>
    </Modal>
  )
}
