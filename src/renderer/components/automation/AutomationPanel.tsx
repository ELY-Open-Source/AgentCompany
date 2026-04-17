import { useCallback, useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowRight, ArrowsClockwise, Lightning, Plus, Robot, X } from "../ui/icons"
import type { AutomationAction, AutomationRuleRecord, AutomationStatus, AutomationTrigger, WorkflowPipelineRecord } from "@shared/types"
import { ActionButton, ConfirmDialog, Card, Eyebrow } from "../ui"
import { useT, type TranslationFn } from "../../i18n"
import { triggerConfig, actionConfig, type AutomationLogEntry } from "./automation-config"
import { timeAgo } from "../../lib/formatters"
import { RuleCard } from "./RuleCard"
import { RuleFormModal } from "./RuleEditor"
import { WorkflowCard } from "./WorkflowList"
import { WorkflowFormModal } from "./WorkflowEditor"

function AutomationActivityLog({ entries, t }: { entries: AutomationLogEntry[]; t: TranslationFn }) {
  if (entries.length === 0) {
    return <div className="py-6 text-center text-[13px] text-muted-foreground">{t("auto.activity.noActivity")}</div>
  }
  return (
    <div className="space-y-1">
      {entries.map((entry, idx) => {
        const ti = triggerConfig[entry.trigger as AutomationTrigger]
        const ai = actionConfig[entry.action as AutomationAction]
        const TIcon = ti?.icon ?? Lightning
        return (
          <motion.div
            key={`${entry.ruleId}-${entry.executedAt}-${idx}`}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.03 }}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-[12px]"
          >
            <TIcon size={14} className="text-primary" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-foreground">{entry.ruleName}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span>{ti?.label ?? entry.trigger}</span>
                <ArrowRight size={8} />
                <span>{ai?.label ?? entry.action}</span>
              </div>
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(entry.executedAt)}</span>
          </motion.div>
        )
      })}
    </div>
  )
}

function RulesPanel({ rules, companyId, onRefresh, t }: { rules: AutomationRuleRecord[]; companyId: string; onRefresh: () => void; t: TranslationFn }) {
  const [showCreate, setShowCreate] = useState(false); const [editRule, setEditRule] = useState<AutomationRuleRecord | null>(null); const [delTarget, setDelTarget] = useState<AutomationRuleRecord | null>(null)
  const [actLog, setActLog] = useState<AutomationLogEntry[]>([]); const [activeTab, setActiveTab] = useState<"rules"|"activity">("rules"); const [filterStatus, setFilterStatus] = useState<AutomationStatus|"all">("all")
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => { void window.agentCompany.getAutomationLog(companyId).then((r) => { if (r.ok) setActLog(r.data) }) }, [companyId, rules])
  const filtered = useMemo(() => filterStatus === "all" ? rules : rules.filter((r) => r.status === filterStatus), [rules, filterStatus])
  const counts = useMemo(() => { let active = 0, paused = 0, error = 0; for (const r of rules) { if (r.status === "active") active++; else if (r.status === "paused") paused++; else if (r.status === "error") error++; } return { total: rules.length, active, paused, error } }, [rules])
  const handleToggle = useCallback(async (rule: AutomationRuleRecord) => { setActionError(null); try { const r = await window.agentCompany.toggleAutomationRule({ id: rule.id, companyId, status: (rule.status === "active" ? "paused" : "active") as "active"|"paused" }); if (!r.ok) { setActionError(r.error.message); return }; onRefresh() } catch (e) { setActionError(e instanceof Error ? e.message : t("auto.failedAction")) } }, [companyId, onRefresh, t])
  const handleDelete = useCallback(async () => { if (!delTarget) return; setActionError(null); try { const r = await window.agentCompany.deleteAutomationRule({ id: delTarget.id, companyId }); if (!r.ok) { setActionError(r.error.message); setDelTarget(null); return }; setDelTarget(null); onRefresh() } catch (e) { setActionError(e instanceof Error ? e.message : t("auto.failedAction")); setDelTarget(null) } }, [delTarget, companyId, onRefresh, t])

  return (
    <div className="space-y-5">
      {actionError ? (
        <div className="flex items-center justify-between rounded-lg bg-destructive-muted px-3.5 py-2.5 text-[12px] font-medium text-destructive">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="ml-2 rounded p-0.5 hover:bg-destructive hover:text-primary-foreground">
            <X size={12} />
          </button>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Lightning size={20} weight="fill" />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-foreground">{t("auto.rules.title")}</h2>
            <p className="text-[12px] text-muted-foreground">
              {t("auto.rules.summaryActive").replace("{n}", String(counts.active))}，{t("auto.rules.summaryPaused").replace("{n}", String(counts.paused))}{counts.error > 0 ? `，${t("auto.rules.summaryErrored").replace("{n}", String(counts.error))}` : ""}
            </p>
          </div>
        </div>
        <ActionButton label={t("auto.rules.newRule")} onClick={() => setShowCreate(true)} icon={Plus} tone="accent" />
      </div>
      {rules.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {[
            { l: t("auto.rules.totalRules"), v: counts.total, accent: false },
            { l: t("auto.rules.totalExecutions"), v: rules.reduce((s, r) => s + r.executionCount, 0), accent: true },
            { l: t("auto.rules.recentActivity"), v: actLog.length, accent: true },
          ].map((s) => (
            <Card key={s.l} padding="sm" className="!py-3.5">
              <Eyebrow>{s.l}</Eyebrow>
              <div className={`text-[26px] font-bold tabular-nums ${s.accent ? "text-primary" : ""}`}>{s.v}</div>
            </Card>
          ))}
        </div>
      ) : null}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <button
          type="button"
          onClick={() => setActiveTab("rules")}
          className={`flex-1 rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${activeTab === "rules" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          {t("auto.rules.tabRules").replace("{n}", String(rules.length))}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("activity")}
          className={`flex-1 rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${activeTab === "activity" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          {t("auto.rules.tabActivity").replace("{n}", String(actLog.length))}
        </button>
      </div>
      {activeTab === "rules" ? (
        <>
          {rules.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {(["all", "active", "paused", "error"] as const).map((s) => {
                const filterLabel = s === "all" ? t("auto.rules.filterAll")
                  : s === "active" ? t("auto.rules.filterActive")
                    : s === "paused" ? t("auto.rules.filterPaused")
                      : t("auto.rules.filterError");
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setFilterStatus(s)}
                    className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${filterStatus === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-[color:var(--border)]"}`}
                  >
                    {filterLabel}
                  </button>
                );
              })}
            </div>
          ) : null}
          {filtered.length === 0 && rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
              <Lightning size={36} className="mb-3 text-muted-foreground" />
              <div className="text-[14px] font-medium text-muted-foreground">{t("auto.rules.noRules")}</div>
              <div className="mx-auto mt-1 max-w-[42ch] text-[12px] leading-relaxed text-muted-foreground">
                {t("auto.rules.noRulesDetail")}
              </div>
              <div className="mt-4">
                <ActionButton label={t("auto.rules.createFirstRule")} onClick={() => setShowCreate(true)} icon={Lightning} tone="accent" />
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-muted-foreground">{t("auto.rules.noRulesFilter")}</div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence>
                {filtered.map((r) => (
                  <RuleCard
                    key={r.id}
                    rule={r}
                    onToggle={() => void handleToggle(r)}
                    onDelete={() => setDelTarget(r)}
                    onEdit={() => setEditRule(r)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      ) : (
        <AutomationActivityLog entries={actLog} t={t} />
      )}
      <AnimatePresence>
        {showCreate ? (
          <RuleFormModal open={showCreate} editingRule={null} companyId={companyId} onClose={() => setShowCreate(false)} onSaved={onRefresh} />
        ) : null}
        {editRule ? (
          <RuleFormModal open={!!editRule} editingRule={editRule} companyId={companyId} onClose={() => setEditRule(null)} onSaved={onRefresh} />
        ) : null}
      </AnimatePresence>
      <ConfirmDialog
        open={!!delTarget}
        title={t("auto.rules.deleteRule")}
        message={delTarget ? t("auto.rules.deleteRuleConfirm").replace("{name}", delTarget.name) : ""}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  )
}

function WorkflowsPanel({ workflows, companyId, onRefresh, t }: { workflows: WorkflowPipelineRecord[]; companyId: string; onRefresh: () => void; t: TranslationFn }) {
  const [showCreate, setShowCreate] = useState(false); const [editWf, setEditWf] = useState<WorkflowPipelineRecord | null>(null); const [delTarget, setDelTarget] = useState<WorkflowPipelineRecord | null>(null)
  const [actionError, setActionError] = useState<string | null>(null); const [runningId, setRunningId] = useState<string | null>(null)
  const handleDelete = useCallback(async () => { if (!delTarget) return; setActionError(null); try { const r = await window.agentCompany.deleteWorkflow({ id: delTarget.id, companyId }); if (!r.ok) { setActionError(r.error.message); setDelTarget(null); return }; setDelTarget(null); onRefresh() } catch (e) { setActionError(e instanceof Error ? e.message : t("auto.failedAction")); setDelTarget(null) } }, [delTarget, companyId, onRefresh, t])
  const handleRun = useCallback(async (wf: WorkflowPipelineRecord) => { setActionError(null); setRunningId(wf.id); try { const r = await window.agentCompany.runWorkflow({ id: wf.id, companyId }); if (!r.ok) { setActionError(r.error.message); return }; onRefresh() } catch (e) { setActionError(e instanceof Error ? e.message : t("auto.failedAction")) } finally { setRunningId(null) } }, [companyId, onRefresh, t])
  const counts = useMemo(() => ({ total: workflows.length, active: workflows.filter((w) => w.status === "active").length, draft: workflows.filter((w) => w.status === "draft").length }), [workflows])
  return (
    <div className="space-y-5">
      {actionError ? (
        <div className="flex items-center justify-between rounded-lg bg-destructive-muted px-3.5 py-2.5 text-[12px] font-medium text-destructive">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="ml-2 rounded p-0.5 hover:bg-destructive hover:text-primary-foreground">
            <X size={12} />
          </button>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ArrowsClockwise size={20} weight="fill" />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-foreground">{t("auto.workflows.title")}</h2>
            <p className="text-[12px] text-muted-foreground">
              {t("auto.workflows.summaryActive").replace("{n}", String(counts.active))}，{t("auto.workflows.summaryDraft").replace("{n}", String(counts.draft))}
              {counts.total > counts.active + counts.draft ? `，${t("auto.workflows.summaryOther").replace("{n}", String(counts.total - counts.active - counts.draft))}` : ""}
            </p>
          </div>
        </div>
        <ActionButton label={t("auto.workflows.newWorkflow")} onClick={() => setShowCreate(true)} icon={Plus} tone="accent" />
      </div>
      {workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <ArrowsClockwise size={36} className="mb-3 text-muted-foreground" />
          <div className="text-[14px] font-medium text-muted-foreground">{t("auto.workflows.noWorkflows")}</div>
          <div className="mx-auto mt-1 max-w-[42ch] text-[12px] leading-relaxed text-muted-foreground">
            {t("auto.workflows.noWorkflowsDetail")}
          </div>
          <div className="mt-4">
            <ActionButton label={t("auto.workflows.createFirstWorkflow")} onClick={() => setShowCreate(true)} icon={ArrowsClockwise} tone="accent" />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {workflows.map((wf) => (
              <WorkflowCard
                key={wf.id}
                workflow={wf}
                isRunning={runningId === wf.id}
                onDelete={() => setDelTarget(wf)}
                onEdit={() => setEditWf(wf)}
                onRun={() => void handleRun(wf)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
      <AnimatePresence>
        {showCreate ? (
          <WorkflowFormModal open={showCreate} editingWorkflow={null} companyId={companyId} onClose={() => setShowCreate(false)} onSaved={onRefresh} />
        ) : null}
        {editWf ? (
          <WorkflowFormModal open={!!editWf} editingWorkflow={editWf} companyId={companyId} onClose={() => setEditWf(null)} onSaved={onRefresh} />
        ) : null}
      </AnimatePresence>
      <ConfirmDialog
        open={!!delTarget}
        title={t("auto.workflows.deleteWorkflow")}
        message={delTarget ? t("auto.workflows.deleteWorkflowConfirm").replace("{name}", delTarget.name) : ""}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  )
}

export function AutomationPanel({ rules, workflows, companyId, onRefresh }: { rules: AutomationRuleRecord[]; workflows: WorkflowPipelineRecord[]; companyId: string; onRefresh: () => void }) {
  const t = useT(); const [activeSection, setActiveSection] = useState<"rules"|"workflows">("rules")
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-primary/20 bg-gradient-to-br from-primary/5 to-primary/[0.02] px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Robot size={20} weight="fill" />
          </div>
          <div>
            <div className="text-[13px] font-semibold text-foreground">{t("auto.automationEngine")}</div>
            <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {t("auto.engineDescription")}
            </div>
          </div>
        </div>
      </div>
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <button
          type="button"
          onClick={() => setActiveSection("rules")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition ${activeSection === "rules" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Lightning size={15} weight={activeSection === "rules" ? "fill" : "regular"} className={activeSection === "rules" ? "text-primary" : ""} />
          {t("auto.tabRules").replace("{n}", String(rules.length))}
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("workflows")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition ${activeSection === "workflows" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          <ArrowsClockwise size={15} weight={activeSection === "workflows" ? "fill" : "regular"} className={activeSection === "workflows" ? "text-primary" : ""} />
          {t("auto.tabWorkflows").replace("{n}", String(workflows.length))}
        </button>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={activeSection}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          {activeSection === "rules" ? (
            <RulesPanel rules={rules} companyId={companyId} onRefresh={onRefresh} t={t} />
          ) : (
            <WorkflowsPanel workflows={workflows} companyId={companyId} onRefresh={onRefresh} t={t} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
