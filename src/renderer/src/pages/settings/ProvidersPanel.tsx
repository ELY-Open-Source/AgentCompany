import { useState, type FormEvent } from "react";
import { Button, Pill } from "../../shared/ui";
import { Dialog } from "../../shared/Dialog";
import { t } from "../../i18n/i18n";
import type {
  AgentRecord,
  ProviderCatalogEntry,
  ProviderAuthProfileRecord,
  ProviderRateLimitStateRecord,
  ProviderRecord,
} from "../../../../shared/domain";
import { PROVIDER_DATA_POLICY } from "../../../../shared/domain";
import { ProviderLogo } from "../../shared/ProviderLogo";
import { ProviderConnectFields, ProviderOAuthFields } from "./ProviderConnectionDialog";
import { composeSecret } from "./provider-secret";
import type { SnapshotActions } from "../../app/useSnapshot";

interface ProvidersPanelProps {
  orgId: string;
  employeeId: string;
  providers: ProviderRecord[];
  authProfiles: ProviderAuthProfileRecord[];
  catalog: ProviderCatalogEntry[];
  agents: AgentRecord[];
  providerRateLimits: ProviderRateLimitStateRecord[];
  actions: SnapshotActions;
}

const POLICY_GRID = "minmax(150px, 1.2fr) minmax(118px, 0.8fr) minmax(140px, 1fr) 112px 124px 124px 92px";
type WorkspaceScope = "organization" | "workspace";

export function ProvidersPanel({ orgId, employeeId, providers, authProfiles, catalog, agents, providerRateLimits, actions }: ProvidersPanelProps) {
  const [active, setActive] = useState<ProviderRecord | null>(null);
  const connected = providers.filter((provider) => provider.enabled);
  const available = providers.filter((provider) => !provider.enabled);
  const activeCatalogEntry = active ? catalog.find((entry) => entry.key === active.providerKey) ?? null : null;
  const activeIsOAuth =
    activeCatalogEntry?.authType === "oauth_pkce" || activeCatalogEntry?.authType === "account_subscription";

  const close = () => {
    setActive(null);
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!active || !activeCatalogEntry || activeIsOAuth) return;
    const form = new FormData(event.currentTarget);
    const secret = composeSecret(activeCatalogEntry, form);
    void actions.run(() => window.agentCompany.saveProviderCredential({
      orgId,
      providerId: active.id,
      secret,
      model: String(form.get("model") ?? "").trim() || null,
      employeeId,
    })).then((result) => { if (result) close(); });
  };

  return (
    <div className="page">
      <h1 className="page-h1">{t("Providers")}</h1>

      {connected.length > 0 && (
        <>
          <div className="section-label" style={{ margin: "16px 0 10px" }}>{t("Connected")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
            {connected.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                authProfile={authProfiles.find((profile) => profile.providerId === provider.id && profile.active) ?? null}
                agents={agents}
                onCheck={() => void actions.run(() => window.agentCompany.checkProviderHealth({ orgId, providerId: provider.id }))}
                onManage={() => setActive(provider)}
                onRevoke={() => void actions.run(() => window.agentCompany.revokeProviderCredential({ orgId, providerId: provider.id }))}
              />
            ))}
          </div>
          <ProviderPolicyTable
            orgId={orgId}
            providers={connected}
            providerRateLimits={providerRateLimits}
            actions={actions}
          />
        </>
      )}

      {available.length > 0 && (
        <>
          <div className="section-label" style={{ marginBottom: 10 }}>{t("Available")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {available.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} onConnect={() => setActive(provider)} />
            ))}
          </div>
        </>
      )}

      <Dialog
        title={active ? t("Connect {label}", { label: active.label }) : t("Connect provider")}
        open={Boolean(active)}
        submitLabel={t("Save")}
        hideSubmit={activeIsOAuth}
        onClose={close}
        onSubmit={save}
      >
        {active && activeCatalogEntry && (
          activeIsOAuth ? (
            <ProviderOAuthFields
              orgId={orgId}
              employeeId={employeeId}
              provider={active}
              entry={activeCatalogEntry}
              onConnected={() => { void actions.reload(); close(); }}
            />
          ) : (
            <ProviderConnectFields provider={active} entry={activeCatalogEntry} />
          )
        )}
      </Dialog>
    </div>
  );
}

function ProviderPolicyTable({
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
      <div className="section-label" style={{ marginBottom: 10 }}>{t("Runtime policy")}</div>
      <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 28 }}>
        <div
          className="table-row head"
          style={{ gridTemplateColumns: POLICY_GRID, minWidth: 900 }}
        >
          <div>{t("Provider")}</div><div>{t("Scope")}</div><div>{t("Data policy")}</div><div>{t("Background")}</div><div>{t("Monthly limit")}</div><div>{t("Context window (tokens)")}</div><div>{t("Usage")}</div>
        </div>
        {providers.map((provider, index) => {
          const rateLimit = requireProviderRateLimit(provider, providerRateLimits);
          return (
            <ProviderPolicyRow
              key={provider.id}
              orgId={orgId}
              provider={provider}
              rateLimit={rateLimit}
              last={index === providers.length - 1}
              actions={actions}
            />
          );
        })}
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

  const savePolicy = () => {
    void actions.run(() => window.agentCompany.updateProviderPolicy({
      orgId,
      providerId: provider.id,
      dataPolicy,
      backgroundEnabled,
      monthlyRequestLimit: Number(monthlyRequestLimit),
      workspaceScope,
      contextWindowTokens: Number(contextWindowTokens),
    }));
  };

  const updateDataPolicy = (value: ProviderRecord["dataPolicy"]) => {
    setDataPolicy(value);
    if (value === PROVIDER_DATA_POLICY.ZERO_DATA_RETENTION) setBackgroundEnabled(false);
  };

  return (
    <div
      className="table-row"
      style={{
        gridTemplateColumns: POLICY_GRID,
        minWidth: 900,
        borderBottom: last ? "none" : "1px solid var(--border-soft)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{provider.label}</div>
      </div>
      <select
        className="input"
        aria-label={t("{label} workspace scope", { label: provider.label })}
        value={workspaceScope}
        onChange={(event) => setWorkspaceScope(event.target.value === "workspace" ? "workspace" : "organization")}
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
      <label className="row" style={{ gap: 8, fontSize: 12, color: "var(--text-2)" }}>
        <input
          aria-label={t("{label} background execution", { label: provider.label })}
          type="checkbox"
          checked={backgroundEnabled}
          disabled={dataPolicy === PROVIDER_DATA_POLICY.ZERO_DATA_RETENTION}
          onChange={(event) => setBackgroundEnabled(event.target.checked)}
        />
        {t("Allow")}
      </label>
      <input
        className="input"
        aria-label={t("{label} monthly request limit", { label: provider.label })}
        type="number"
        min={1}
        value={monthlyRequestLimit}
        onChange={(event) => setMonthlyRequestLimit(event.target.value)}
      />
      <input
        className="input"
        aria-label={t("{label} context window", { label: provider.label })}
        title={t("The model's context window. Runs keep prompts, skills, history, and tool results inside it.")}
        type="number"
        min={24000}
        step={1000}
        value={contextWindowTokens}
        onChange={(event) => setContextWindowTokens(event.target.value)}
      />
      <div>
        <div className="num mono">{rateLimit.requestCount} / {rateLimit.monthlyRequestLimit}</div>
        <button type="button" className="button small" aria-label={t("Save {label} policy", { label: provider.label })} onClick={savePolicy}>
          {t("Save")}
        </button>
      </div>
    </div>
  );
}

function ProviderRow({
  provider,
  authProfile,
  agents,
  onCheck,
  onManage,
  onRevoke,
}: {
  provider: ProviderRecord;
  authProfile: ProviderAuthProfileRecord | null;
  agents: AgentRecord[];
  onCheck: () => void;
  onManage: () => void;
  onRevoke: () => void;
}) {
  const boundCount = agents.filter((agent) => agent.modelProviderId === provider.id).length;
  return (
    <div
      className="reveal-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: 14,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 10,
      }}
    >
      <ProviderLogo providerKey={provider.providerKey} label={provider.label} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{provider.label}</div>
        <div style={{ fontSize: 12, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {provider.model ? `${provider.model} · ` : ""}{readableAuth(provider.authType)}{authProfile ? ` · ${authProfile.sourceType}` : ""}
        </div>
      </div>
      <ProviderHealth provider={provider} />
      <div className="num mono" style={{ fontSize: 13, minWidth: 72, textAlign: "right" }}>
        {boundCount === 1 ? t("{count} agent", { count: boundCount }) : t("{count} agents", { count: boundCount })}
      </div>
      <span className="reveal row" style={{ gap: 6 }}>
        <Button onClick={onCheck}>{t("Check")}</Button>
        <Button onClick={onManage}>{t("Manage")}</Button>
        <Button tone="ghost" onClick={onRevoke}>{t("Revoke")}</Button>
      </span>
    </div>
  );
}

function ProviderHealth({ provider }: { provider: ProviderRecord }) {
  if (provider.healthState === "healthy") return <Pill tone="green">{t("Healthy")}</Pill>;
  if (provider.healthState === "failed") return <Pill tone="red">{t("Failed")}</Pill>;
  return <Pill>{t("Unchecked")}</Pill>;
}

function ProviderCard({ provider, onConnect }: { provider: ProviderRecord; onConnect: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 14,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        minWidth: 0,
      }}
    >
      <ProviderLogo providerKey={provider.providerKey} label={provider.label} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{provider.label}</div>
        <div style={{ fontSize: 12, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {readableAuth(provider.authType)}
        </div>
      </div>
      <Pill>{readableAuth(provider.authType)}</Pill>
      <Button size="small" onClick={onConnect}>{t("Connect")}</Button>
    </div>
  );
}

function readableAuth(authType: ProviderRecord["authType"]): string {
  if (authType === "api_key") return t("API key");
  if (authType === "oauth_pkce") return t("OAuth");
  if (authType === "account_subscription") return t("Account");
  if (authType === "cloud") return t("Cloud");
  return authType;
}

function requireProviderRateLimit(
  provider: ProviderRecord,
  rateLimits: ProviderRateLimitStateRecord[],
): ProviderRateLimitStateRecord {
  const rateLimit = rateLimits.find((item) => item.providerId === provider.id);
  if (!rateLimit) throw new Error(`Provider rate limit state missing for ${provider.id}.`);
  return rateLimit;
}
