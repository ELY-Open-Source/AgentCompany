import { useUnsaved } from "../../shared/unsaved";
import { useState } from "react";
import { Pill } from "../../shared/ui";
import { t } from "../../i18n/i18n";
import type { ProviderRateLimitStateRecord, ProviderRecord } from "../../../../shared/domain";
import { PROVIDER_DATA_POLICY } from "../../../../shared/domain";
import type { SnapshotActions } from "../../app/useSnapshot";

const POLICY_GRID = "minmax(150px, 1.2fr) minmax(118px, 0.8fr) minmax(140px, 1fr) 112px 124px 124px 132px";
type WorkspaceScope = "organization" | "workspace";

export function ProviderPolicyTable({
  orgId,
  providers,
  providerRateLimits,
  actions,
}: {
  orgId: string;
  providers: ProviderRecord[];
  providerRateLimits: ProviderRateLimitStateRecord[];
  actions: SnapshotActions;
}) {
  return (
    <>
      <div className="section-label" style={{ marginBottom: 6 }}>{t("Runtime policy")}</div>
      {/* What each column governs, so a change is made knowing what it reaches. */}
      <ul style={{ fontSize: "var(--fs-body)", color: "var(--text-3)", lineHeight: 1.6, margin: "0 0 10px", paddingLeft: 18 }}>
        <li>{t("Scope: “Workspace” refuses every call that is not made for a workspace, including agent sessions on tasks without one.")}</li>
        <li>{t("Data policy: zero data retention refuses background requests, so it also switches background off.")}</li>
        <li>{t("Background: lets requests from the request console run in the provider's background mode.")}</li>
        <li>{t("Monthly limit: counts every model call this company makes through the provider in the calendar month (UTC); at the limit, calls are refused and agent work waits until the month resets.")}</li>
        <li>{t("Context window: the size new sessions fit prompts, skills, history and tool results into; sessions already running keep theirs.")}</li>
      </ul>
      <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 28 }}>
        <div
          className="table-row head"
          style={{ gridTemplateColumns: POLICY_GRID, minWidth: 940 }}
        >
          <div>{t("Provider")}</div><div>{t("Scope")}</div><div>{t("Data policy")}</div><div>{t("Background")}</div><div>{t("Monthly limit")}</div><div>{t("Context window (tokens)")}</div><div>{t("Usage")}</div>
        </div>
        {providers.map((provider, index) => (
          <ProviderPolicyRow
            key={provider.id}
            orgId={orgId}
            provider={provider}
            rateLimit={requireProviderRateLimit(provider, providerRateLimits)}
            last={index === providers.length - 1}
            actions={actions}
          />
        ))}
      </div>
    </>
  );
}

function ProviderPolicyRow({
  orgId,
  provider,
  rateLimit,
  last,
  actions,
}: {
  orgId: string;
  provider: ProviderRecord;
  rateLimit: ProviderRateLimitStateRecord;
  last: boolean;
  actions: SnapshotActions;
}) {
  const [dataPolicy, setDataPolicy] = useState(provider.dataPolicy);
  const [backgroundEnabled, setBackgroundEnabled] = useState(provider.backgroundEnabled);
  const [monthlyRequestLimit, setMonthlyRequestLimit] = useState(String(provider.monthlyRequestLimit));
  const [contextWindowTokens, setContextWindowTokens] = useState(String(provider.contextWindowTokens));
  const [workspaceScope, setWorkspaceScope] = useState<WorkspaceScope>(provider.workspaceScope === "workspace" ? "workspace" : "organization");
  const [linkedNote, setLinkedNote] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "saving" | "saved" } | { kind: "error"; message: string } | null>(null);
  const savedScope = provider.workspaceScope === "workspace" ? "workspace" : "organization";
  const dirty = dataPolicy !== provider.dataPolicy
    || backgroundEnabled !== provider.backgroundEnabled
    || Number(monthlyRequestLimit) !== provider.monthlyRequestLimit
    || Number(contextWindowTokens) !== provider.contextWindowTokens
    || workspaceScope !== savedScope;
  useUnsaved(dirty);
  const edited = <T,>(set: (value: T) => void) => (value: T) => { set(value); setStatus(null); };

  const savePolicy = () => {
    setStatus({ kind: "saving" });
    actions.run(() => window.agentCompany.updateProviderPolicy({
      orgId,
      providerId: provider.id,
      dataPolicy,
      backgroundEnabled,
      monthlyRequestLimit: Number(monthlyRequestLimit),
      workspaceScope,
      contextWindowTokens: Number(contextWindowTokens),
    }))
      .then((snapshot) => {
        const saved = snapshot?.providers.find((item) => item.id === provider.id);
        if (!saved) return setStatus(null);
        // The fields show what the backend stored (025 reads back as 25, 26.9 as 26).
        setMonthlyRequestLimit(String(saved.monthlyRequestLimit));
        setContextWindowTokens(String(saved.contextWindowTokens));
        setStatus({ kind: "saved" });
        setLinkedNote(null);
      })
      .catch((failure: unknown) => setStatus({ kind: "error", message: failure instanceof Error ? failure.message : String(failure) }));
  };

  const updateDataPolicy = (value: ProviderRecord["dataPolicy"]) => {
    edited(setDataPolicy)(value);
    if (value === PROVIDER_DATA_POLICY.ZERO_DATA_RETENTION && backgroundEnabled) {
      setBackgroundEnabled(false);
      setLinkedNote(t("Zero data retention switched background off."));
    } else setLinkedNote(null);
  };

  return (
    <div
      className="table-row"
      style={{
        gridTemplateColumns: POLICY_GRID,
        minWidth: 940,
        borderBottom: last ? "none" : "1px solid var(--border-soft)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{provider.label}</div>
        {linkedNote && <div style={{ fontSize: "var(--fs-body)", color: "var(--text-3)" }}>{linkedNote}</div>}
      </div>
      <select
        className="input"
        aria-label={t("{label} workspace scope", { label: provider.label })}
        value={workspaceScope}
        onChange={(event) => edited(setWorkspaceScope)(event.target.value === "workspace" ? "workspace" : "organization")}
      >
        <option value="organization">{t("Organization")}</option>
        <option value="workspace">{t("Workspace")}</option>
      </select>
      <select
        className="input"
        aria-label={t("{label} data policy", { label: provider.label })}
        value={dataPolicy}
        onChange={(event) => updateDataPolicy(event.target.value as ProviderRecord["dataPolicy"])}
      >
        <option value={PROVIDER_DATA_POLICY.STANDARD}>{t("Standard retention")}</option>
        <option value={PROVIDER_DATA_POLICY.ZERO_DATA_RETENTION}>{t("Zero data retention")}</option>
      </select>
      <label className="row" style={{ gap: 8, fontSize: "var(--fs-body)", color: "var(--text-2)" }}>
        <input
          aria-label={t("{label} background execution", { label: provider.label })}
          type="checkbox"
          checked={backgroundEnabled}
          disabled={dataPolicy === PROVIDER_DATA_POLICY.ZERO_DATA_RETENTION}
          onChange={(event) => edited(setBackgroundEnabled)(event.target.checked)}
        />
        {t("Allow")}
      </label>
      <input
        className="input"
        aria-label={t("{label} monthly request limit", { label: provider.label })}
        type="number"
        min={1}
        value={monthlyRequestLimit}
        onChange={(event) => edited(setMonthlyRequestLimit)(event.target.value)}
      />
      <input
        className="input"
        aria-label={t("{label} context window", { label: provider.label })}
        title={t("The model's context window. Runs keep prompts, skills, history, and tool results inside it.")}
        type="number"
        min={24000}
        step={1000}
        value={contextWindowTokens}
        onChange={(event) => edited(setContextWindowTokens)(event.target.value)}
      />
      <div>
        <div className="num mono">{rateLimit.requestCount} / {rateLimit.monthlyRequestLimit}</div>
        <div style={{ fontSize: "var(--fs-body)", color: "var(--text-3)" }}>{t("Resets {date} (UTC)", { date: rateLimit.windowEnd.slice(0, 10) })}</div>
        <div className="row" style={{ gap: 6, marginTop: 4 }}>
          <button type="button" className="button small" aria-label={t("Save {label} policy", { label: provider.label })} onClick={savePolicy} disabled={!dirty || status?.kind === "saving"}>
            {t("Save")}
          </button>
          {dirty && status?.kind !== "saving" && <Pill tone="amber">{t("Unsaved")}</Pill>}
          {!dirty && status?.kind === "saved" && <Pill tone="green">{t("Saved")}</Pill>}
        </div>
        {status?.kind === "error" && <div className="form-error" role="alert">{status.message}</div>}
      </div>
    </div>
  );
}

function requireProviderRateLimit(
  provider: ProviderRecord,
  rateLimits: ProviderRateLimitStateRecord[],
): ProviderRateLimitStateRecord {
  const rateLimit = rateLimits.find((item) => item.providerId === provider.id);
  if (!rateLimit) throw new Error(`Provider rate limit state missing for ${provider.id}.`);
  return rateLimit;
}
