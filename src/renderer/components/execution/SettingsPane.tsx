import { useEffect, useState } from "react"
import { ArrowClockwise, CheckCircle, ClockCounterClockwise, Download, Trash } from "@phosphor-icons/react"
import type { ProfileSnapshot, SecretRecord } from "@shared/types"
import type { AppLocale } from "@shared/locale"
import { APP_LOCALES, LOCALE_LABELS } from "@shared/locale"
import { useLocale, useT } from "../../i18n"
import { formatTime } from "../../lib/formatters"
import { unwrap } from "../../lib/desktop"
import { ActionButton, ConfirmDialog, EmptyState, InlineNotice, Select } from "../ui"
import { describeActionError } from "./execution-utils"
import { useAppStore } from "../../state/store"

export function SettingsPane({ snapshot, secrets, companyId, onSaved }: { snapshot: ProfileSnapshot; secrets: SecretRecord[]; companyId: string; onSaved: () => Promise<void> }) {
  const t = useT(); const currentLocale = useLocale(); const addToast = useAppStore((s) => s.addToast)
  const [theme, setTheme] = useState(snapshot.theme); const [selectedLocale, setSelectedLocale] = useState<AppLocale>(snapshot.locale ?? currentLocale); const [updatesEnabled, setUpdatesEnabled] = useState(snapshot.updatesEnabled)
  const [confirmDeleteSecretId, setConfirmDeleteSecretId] = useState<string | null>(null); const [actionError, setActionError] = useState<string | null>(null); const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [deleteSecretError, setDeleteSecretError] = useState<string | null>(null); const [loadingAction, setLoadingAction] = useState<"save"|"check"|"backup"|"restore"|null>(null)
  const secretToDelete = secrets.find((s) => s.id === confirmDeleteSecretId) ?? null

  useEffect(() => { setTheme(snapshot.theme); setUpdatesEnabled(snapshot.updatesEnabled); if (snapshot.locale) setSelectedLocale(snapshot.locale) }, [snapshot.theme, snapshot.updatesEnabled, snapshot.locale])
  async function handleDeleteSecret(id: string) { setDeleteSecretError(null); setActionError(null); setActionNotice(null); try { unwrap(await window.agentCompany.deleteSecret({ id, companyId })); setConfirmDeleteSecretId(null); setActionNotice("Secret deleted."); addToast("Secret deleted", "success"); await onSaved() } catch (e) { setDeleteSecretError(describeActionError(e)) } }
  async function handleSaveSettings() { setActionError(null); setActionNotice(null); setLoadingAction("save"); try { unwrap(await window.agentCompany.updateSettings({ theme, locale: selectedLocale, updatesEnabled })); await onSaved(); setActionNotice("Settings saved."); addToast("Settings saved", "success") } catch (e) { setActionError(describeActionError(e)) } finally { setLoadingAction(null) } }
  async function handleCheckForUpdates() { setActionError(null); setActionNotice(null); setLoadingAction("check"); try { const started = unwrap(await window.agentCompany.checkForUpdates()); setActionNotice(started ? "Update check started." : "Update check skipped because no release update feed is configured.") } catch (e) { setActionError(describeActionError(e)) } finally { setLoadingAction(null) } }
  async function handleBackupProfile() { setActionError(null); setActionNotice(null); setLoadingAction("backup"); try { const backupPath = unwrap(await window.agentCompany.backupProfile()); if (backupPath) { setActionNotice(`Profile backup created at ${backupPath}.`); addToast("Profile backup created", "success") } } catch (e) { setActionError(describeActionError(e)) } finally { setLoadingAction(null) } }
  async function handleRestoreProfile() { setActionError(null); setActionNotice(null); setLoadingAction("restore"); try { const restored = unwrap(await window.agentCompany.restoreProfile()); if (!restored) return; await onSaved(); setActionNotice("Profile restored."); addToast("Profile restored", "success") } catch (e) { setActionError(describeActionError(e)) } finally { setLoadingAction(null) } }

  return (
    <div className="space-y-6">
      <ConfirmDialog open={confirmDeleteSecretId !== null} title="Delete secret" message={`Permanently delete secret "${secretToDelete?.name ?? ""}"? Any connectors referencing it will lose access.`} errorMessage={deleteSecretError} onConfirm={() => confirmDeleteSecretId && void handleDeleteSecret(confirmDeleteSecretId)} onCancel={() => { setDeleteSecretError(null); setConfirmDeleteSecretId(null) }} />
      {actionError ? <InlineNotice message={actionError} /> : null}
      {!actionError && actionNotice ? <InlineNotice message={actionNotice} tone="success" /> : null}
      <div><div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("exec.profile")}</div><div className="border-y border-border py-4"><div className="mb-2 text-[11px] text-muted-foreground">{t("exec.profilePath")}</div><div className="font-mono truncate text-[11px] text-muted-foreground">{snapshot.profilePath}</div></div></div>
      <div><div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("exec.preferences")}</div>
        <Select label={t("settings.theme")} value={theme} onChange={(v) => { const next = v as ProfileSnapshot["theme"]; setTheme(next); const root = document.documentElement; root.className = next; root.style.colorScheme = next === "system" ? "light dark" : next; void window.agentCompany.updateSettings({ theme: next }).then(() => onSaved()) }} options={[{ value: "system", label: t("settings.system") }, { value: "dark", label: t("settings.dark") }, { value: "light", label: t("settings.light") }]} />
        <div className="mt-3"><Select label={t("settings.language")} value={selectedLocale} onChange={(v) => setSelectedLocale(v as AppLocale)} options={APP_LOCALES.map((loc) => ({ value: loc, label: LOCALE_LABELS[loc] }))} /></div>
        <div className="border-y border-border py-4 mt-3"><label className="flex items-center justify-between text-[13px] text-muted-foreground"><span>{t("exec.enableUpdater")}</span><input type="checkbox" checked={updatesEnabled} onChange={(e) => setUpdatesEnabled(e.target.checked)} /></label></div>
      </div>
      {(() => { const company = snapshot.companies.find((c) => c.id === companyId); if (!company) return null; const isCeo = company.executionMode !== "ai_cofounder"; return (
        <div><div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("exec.executionMode")}</div>
          <div className="space-y-3">
            <button type="button" onClick={async () => { if (isCeo) return; setActionError(null); try { unwrap(await window.agentCompany.saveCompany({ id: company.id, name: company.name, description: company.description, status: company.status, autoApproveHires: true, reviewDeliverables: false, executionMode: "ai_ceo" })); await onSaved(); addToast(t("exec.modeSwitched"), "success") } catch (err) { setActionError(describeActionError(err)) } }} className={`w-full rounded-lg border-2 px-4 py-3 text-left transition ${isCeo ? "border-[color:var(--primary)] bg-accent" : "border-border bg-muted hover:border-[color:var(--muted-foreground)] cursor-pointer"}`}>
              <div className="text-[13px] font-semibold text-foreground">AI CEO <span className="ml-1 text-[10px] font-normal text-muted-foreground">{t("exec.modeCeoTag")}</span></div>
              <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("exec.modeCeoDesc")}</div>
            </button>
            <button type="button" onClick={async () => { if (!isCeo) return; setActionError(null); try { unwrap(await window.agentCompany.saveCompany({ id: company.id, name: company.name, description: company.description, status: company.status, autoApproveHires: false, reviewDeliverables: true, executionMode: "ai_cofounder" })); await onSaved(); addToast(t("exec.modeSwitched"), "success") } catch (err) { setActionError(describeActionError(err)) } }} className={`w-full rounded-lg border-2 px-4 py-3 text-left transition ${!isCeo ? "border-[color:var(--primary)] bg-accent" : "border-border bg-muted hover:border-[color:var(--muted-foreground)] cursor-pointer"}`}>
              <div className="text-[13px] font-semibold text-foreground">AI Co-Founder <span className="ml-1 text-[10px] font-normal text-muted-foreground">{t("exec.modeCofounderTag")}</span></div>
              <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("exec.modeCofounderDesc")}</div>
            </button>
          </div></div>) })()}
      <div><div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Keyboard Shortcuts</div>
        <div className="space-y-1 border-y border-border py-3">
          {([
            [navigator.platform.includes("Mac") ? "⌘K" : "Ctrl+K", "Open command palette"],
            [navigator.platform.includes("Mac") ? "⌘Enter" : "Ctrl+Enter", "Send message"],
            ["Escape", "Close modal / palette"],
            ["↑ / ↓", "Navigate palette results"],
            ["Enter", "Select palette result"],
            ["Tab", "Move focus between elements"],
          ] as const).map(([key, desc]) => (
            <div key={key} className="flex items-center justify-between px-3 py-1.5 text-[12px]">
              <span className="text-muted-foreground">{desc}</span>
              <kbd className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-[11px] text-foreground">{key}</kbd>
            </div>
          ))}
        </div>
      </div>
      <div><div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("exec.actions")}</div><div className="grid gap-3 md:grid-cols-2"><ActionButton label={t("exec.saveSettings")} tone="accent" onClick={() => void handleSaveSettings()} icon={CheckCircle} loading={loadingAction === "save"} /><ActionButton label={t("exec.checkForUpdates")} onClick={() => void handleCheckForUpdates()} icon={Download} loading={loadingAction === "check"} /><ActionButton label={t("exec.backupProfile")} onClick={() => void handleBackupProfile()} icon={ClockCounterClockwise} loading={loadingAction === "backup"} /><ActionButton label={t("exec.restoreProfile")} onClick={() => void handleRestoreProfile()} icon={ArrowClockwise} loading={loadingAction === "restore"} /></div></div>
      <div><div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("exec.secretBackend")}</div><div className="border-y border-border py-3 text-[13px] text-muted-foreground">{snapshot.backend.secretBackend}</div></div>
      <div><div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("exec.secrets")} ({secrets.length})</div>{secrets.length === 0 ? <EmptyState title={t("exec.noSecretsStored")} /> : <div className="border-y border-border overflow-x-auto"><table className="w-full text-left text-[13px]"><thead><tr className="border-b border-border"><th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("exec.secretName")}</th><th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("exec.secretDescription")}</th><th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("exec.secretBackendCol")}</th><th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("exec.secretUpdated")}</th><th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground" /></tr></thead><tbody>{secrets.map((s) => <tr key={s.id} className="border-b border-border last:border-b-0"><td className="px-4 py-3 font-medium text-foreground">{s.name}</td><td className="px-4 py-3 text-muted-foreground">{s.description || "\u2014"}</td><td className="px-4 py-3 font-mono text-muted-foreground">{s.backend}</td><td className="px-4 py-3 font-mono text-muted-foreground">{formatTime(s.updatedAt)}</td><td className="px-4 py-3"><ActionButton label="Delete" onClick={() => setConfirmDeleteSecretId(s.id)} icon={Trash} tone="danger" /></td></tr>)}</tbody></table></div>}</div>
    </div>
  )
}
