import { useEffect, useMemo, useState } from "react"
import type { CommentRecord, ProfileSnapshot, RunRecord } from "@shared/types"
import { useT } from "../../i18n"
import { formatMoney, formatTime } from "../../lib/formatters"
import { unwrap } from "../../lib/desktop"
import { ActionButton, InlineNotice, StatusPill } from "../ui"
import { MarkdownBody } from "../ui/MarkdownBody"
import { ArrowRight } from "../ui/icons"
import { describeActionError } from "./execution-utils"

type ActivityFilter = "all" | "comments" | "runs"

export function TaskInspectorActivity({
  taskId, companyId, agents, comments, runs, onRefresh,
}: {
  taskId: string
  companyId: string
  agents: ProfileSnapshot["agents"]
  comments: CommentRecord[]
  runs: RunRecord[]
  onRefresh: () => Promise<void>
}) {
  const t = useT()
  const [filter, setFilter] = useState<ActivityFilter>("all")
  const [newComment, setNewComment] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])

  useEffect(() => {
    const unsubscribe = window.agentCompany.subscribe((event) => {
      if (event.type === "agent-message" && event.taskId === taskId) void onRefresh()
    })
    return unsubscribe
  }, [onRefresh, taskId])

  const handleSubmit = async () => {
    if (!newComment.trim()) return
    setSubmitError(null); setSubmitting(true)
    try {
      unwrap(await window.agentCompany.addComment({ companyId, taskId, authorName: "Board", body: newComment.trim() }))
      setNewComment("")
      await onRefresh()
    } catch (e) {
      setSubmitError(describeActionError(e))
    } finally {
      setSubmitting(false)
    }
  }

  type FeedItem =
    | { kind: "comment"; ts: number; data: CommentRecord }
    | { kind: "run"; ts: number; data: RunRecord }

  const feed: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = []
    const toMs = (value: string | null) => (value ? Date.parse(value) : 0)
    if (filter === "all" || filter === "comments") {
      for (const c of comments) items.push({ kind: "comment", ts: toMs(c.createdAt), data: c })
    }
    if (filter === "all" || filter === "runs") {
      for (const r of runs) items.push({ kind: "run", ts: toMs(r.startedAt ?? r.createdAt), data: r })
    }
    items.sort((a, b) => b.ts - a.ts)
    return items
  }, [comments, runs, filter])

  const filterBtn = (key: ActivityFilter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(key)}
      className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition ${
        filter === key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {filterBtn("all", t("exec.activityAll", "All"))}
        {filterBtn("comments", t("exec.communication"))}
        {filterBtn("runs", t("exec.runHistory"))}
        <span className="ml-auto text-[11px] text-muted-foreground">{feed.length}</span>
      </div>

      {feed.length === 0 ? (
        <div className="text-[12px] text-muted-foreground">{t("exec.noMessagesYet")}</div>
      ) : (
        <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-lg border border-border p-3">
          {feed.map((item) => {
            if (item.kind === "comment") {
              const c = item.data
              const isAgent = Boolean(c.authorAgentId)
              const agent = isAgent ? agentMap.get(c.authorAgentId ?? "") : null
              return (
                <div key={`c-${c.id}`} className="rounded-md bg-muted px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-[12px] font-semibold ${isAgent ? "text-primary" : "text-foreground"}`}>{c.authorName}</span>
                    {agent && <span className="text-[10px] text-muted-foreground">{agent.role}</span>}
                    <span className="text-[10px] text-muted-foreground">{formatTime(c.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-[13px] text-foreground"><MarkdownBody body={c.body} /></div>
                </div>
              )
            }
            const run = item.data
            const runAgent = agentMap.get(run.agentId)
            const isActive = run.status === "running" || run.status === "queued"
            const needsAttention = run.status === "failed" || run.status === "timed_out"
            // Two tiers only: resting (default border + muted bg) vs attention
            // (destructive border + muted bg). Active runs earn a pulsing dot,
            // not a third border color — less rhythm, more signal.
            return (
              <div
                key={`r-${run.id}`}
                className={`rounded-lg border px-3 py-2.5 bg-muted ${
                  needsAttention ? "border-destructive" : "border-border"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {isActive ? <span className="h-2 w-2 animate-pulse rounded-full bg-success" /> : null}
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {run.summary || (isActive ? t("exec.runningEllipsis") : t("exec.completedRun"))}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                      {runAgent ? <span>{runAgent.name}</span> : null}
                      <span>{run.connectorId.replace("_local", "")}</span>
                      {run.model ? <span className="font-mono">{run.model}</span> : null}
                      <span>{formatTime(run.startedAt)}</span>
                      {run.costUsd != null && run.costUsd > 0 ? <span className="font-mono tabular-nums">{formatMoney(run.costUsd)}</span> : null}
                    </div>
                  </div>
                  <StatusPill status={run.status} />
                </div>
                {run.errorMessage ? (
                  <div className="mt-1.5 rounded bg-destructive-muted px-2 py-1 text-[11px] text-destructive break-words">
                    {run.errorMessage}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {submitError ? <InlineNotice message={submitError} /> : null}
      <div className="flex gap-2">
        <input
          aria-label={t("exec.sendMessage")}
          className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-[color:var(--primary)] focus:outline-none"
          placeholder={t("exec.sendMessage")}
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSubmit() } }}
        />
        <ActionButton label={t("exec.send")} tone="accent" onClick={() => void handleSubmit()} icon={ArrowRight} loading={submitting} />
      </div>
    </div>
  )
}
