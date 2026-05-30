import { useState, type FormEvent } from "react";
import { Button, Field, Pill } from "../../shared/ui";
import { Dialog } from "../../shared/Dialog";
import { ProviderOAuthConnect } from "../../shared/ProviderOAuthConnect";
import type {
  AgentRecord,
  ProviderCatalogEntry,
  ProviderAuthProfileRecord,
  ProviderRateLimitStateRecord,
  ProviderRecord,
  ProviderRequestRecord,
  WorkspaceRecord,
} from "../../../../shared/domain";
import { PROVIDER_DATA_POLICY } from "../../../../shared/domain";
import { ProviderLogo } from "./ProviderLogo";
import { ProviderRequestPanel } from "./ProviderRequestPanel";
import type { SnapshotActions } from "../../app/useSnapshot";

interface ProvidersPanelProps {
  orgId: string;
  employeeId: string;
  providers: ProviderRecord[];
  authProfiles: ProviderAuthProfileRecord[];
  catalog: ProviderCatalogEntry[];
  agents: AgentRecord[];
  workspaces: WorkspaceRecord[];
  providerRateLimits: ProviderRateLimitStateRecord[];
  providerRequests: ProviderRequestRecord[];
  actions: SnapshotActions;
}

interface CloudFields {
  baseUrl: string;
  region: string;
  projectId: string;
  deployment: string;
}

const CLOUD_DEFAULTS: CloudFields = { baseUrl: "", region: "", projectId: "", deployment: "" };
const POLICY_GRID = "minmax(150px, 1.2fr) minmax(118px, 0.8fr) minmax(140px, 1fr) 112px 124px 92px";
type WorkspaceScope = "organization" | "workspace";

export function ProvidersPanel({ orgId, employeeId, providers, authProfiles, catalog, agents, workspaces, providerRateLimits, providerRequests, actions }: ProvidersPanelProps) {
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
      <h1 className="page-h1">Providers</h1>
      <p className="page-sub">Connect model providers — keys, accounts, OAuth.</p>

      {connected.length > 0 && (
        <>
          <div className="section-label" style={{ marginBottom: 10 }}>Connected</div>
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
          <ProviderRequestPanel
            orgId={orgId}
            providers={connected}
            catalog={catalog}
            workspaces={workspaces}
            providerRequests={providerRequests}
            actions={actions}
          />
        </>
      )}

      {available.length > 0 && (
        <>
          <div className="section-label" style={{ marginBottom: 10 }}>Available</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {available.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} onConnect={() => setActive(provider)} />
            ))}
          </div>
        </>
      )}

      <Dialog
        title={active ? `Connect ${active.label}` : "Connect provider"}
        open={Boolean(active)}
        submitLabel="Save"
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
      <div className="section-label" style={{ marginBottom: 10 }}>Runtime policy</div>
      <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 28 }}>
        <div
          className="table-row head"
          style={{ gridTemplateColumns: POLICY_GRID, minWidth: 780 }}
        >
          <div>Provider</div><div>Scope</div><div>Data policy</div><div>Background</div><div>Monthly limit</div><div>Usage</div>
        </div>
        {providers.map((provider, index) => {
          const rateLimit = requireProviderRateLimit(provider, providerRateLimits);
          return (
            <ProviderPolicyRow
              key={`${provider.id}:${provider.dataPolicy}:${provider.backgroundEnabled}:${provider.monthlyRequestLimit}`}
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
  const [workspaceScope, setWorkspaceScope] = useState<WorkspaceScope>(provider.workspaceScope === "workspace" ? "workspace" : "organization");

  const savePolicy = () => {
    void actions.run(() => window.agentCompany.updateProviderPolicy({
      orgId,
      providerId: provider.id,
      dataPolicy,
      backgroundEnabled,
      monthlyRequestLimit: Number(monthlyRequestLimit),
      workspaceScope,
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
        minWidth: 780,
        borderBottom: last ? "none" : "1px solid var(--border-soft)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{provider.label}</div>
      </div>
      <select
        className="input"
        aria-label={`${provider.label} workspace scope`}
        value={workspaceScope}
        onChange={(event) => setWorkspaceScope(event.target.value === "workspace" ? "workspace" : "organization")}
      >
        <option value="organization">Organization</option>
        <option value="workspace">Workspace</option>
      </select>
      <select
        className="input"
        aria-label={`${provider.label} data policy`}
        value={dataPolicy}
        onChange={(event) => updateDataPolicy(event.target.value as ProviderRecord["dataPolicy"])}
      >
        <option value={PROVIDER_DATA_POLICY.STANDARD}>Standard retention</option>
        <option value={PROVIDER_DATA_POLICY.ZERO_DATA_RETENTION}>Zero data retention</option>
      </select>
      <label className="row" style={{ gap: 8, fontSize: 12, color: "var(--text-2)" }}>
        <input
          aria-label={`${provider.label} background execution`}
          type="checkbox"
          checked={backgroundEnabled}
          disabled={dataPolicy === PROVIDER_DATA_POLICY.ZERO_DATA_RETENTION}
          onChange={(event) => setBackgroundEnabled(event.target.checked)}
        />
        Allow
      </label>
      <input
        className="input"
        aria-label={`${provider.label} monthly request limit`}
        type="number"
        min={1}
        value={monthlyRequestLimit}
        onChange={(event) => setMonthlyRequestLimit(event.target.value)}
      />
      <div>
        <div className="num mono">{rateLimit.requestCount} / {rateLimit.monthlyRequestLimit}</div>
        <button type="button" className="button small" aria-label={`Save ${provider.label} policy`} onClick={savePolicy}>
          Save
        </button>
      </div>
    </div>
  );
}

function ProviderConnectFields({
  provider,
  entry,
}: {
  provider: ProviderRecord;
  entry: ProviderCatalogEntry;
}) {
  if (entry.authType === "api_key") {
    return (
      <>
        <p style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.5, margin: 0 }}>{entry.credentialHelp}</p>
        <Field label="API key"><input className="input" name="secret" type="password" required autoFocus /></Field>
        <ModelPicker entry={entry} provider={provider} />
      </>
    );
  }
  return <CloudFieldsForm entry={entry} provider={provider} />;
}

function ProviderOAuthFields({
  orgId,
  employeeId,
  provider,
  entry,
  onConnected,
}: {
  orgId: string;
  employeeId: string;
  provider: ProviderRecord;
  entry: ProviderCatalogEntry;
  onConnected: () => void;
}) {
  const [model, setModel] = useState(provider.model ?? entry.defaultModel ?? entry.models[0]?.id ?? "");
  return (
    <>
      <p style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.5, margin: 0 }}>{entry.credentialHelp}</p>
      <Field label="Default model">
        {entry.models.length ? (
          <select className="input" value={model} onChange={(event) => setModel(event.target.value)}>
            {entry.models.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        ) : (
          <input className="input" value={model} onChange={(event) => setModel(event.target.value)} />
        )}
      </Field>
      <ProviderOAuthConnect
        key={entry.key}
        providerKey={entry.key}
        label={entry.label}
        buildInput={() => ({ providerKey: entry.key, orgId, providerId: provider.id, employeeId, model })}
        onComplete={() => onConnected()}
      />
    </>
  );
}

function ModelPicker({ entry, provider }: { entry: ProviderCatalogEntry; provider: ProviderRecord }) {
  const defaultValue = provider.model ?? entry.defaultModel ?? entry.models[0]?.id ?? "";
  if (entry.models.length === 0) {
    return (
      <Field label="Default model">
        <input className="input" name="model" defaultValue={defaultValue} />
      </Field>
    );
  }
  return (
    <Field label="Default model">
      <select className="input" name="model" defaultValue={defaultValue}>
        {entry.models.map((model) => (
          <option key={model.id} value={model.id}>{model.name}</option>
        ))}
      </select>
    </Field>
  );
}

function CloudFieldsForm({ entry, provider }: { entry: ProviderCatalogEntry; provider: ProviderRecord }) {
  const [state, setState] = useState<CloudFields>(CLOUD_DEFAULTS);
  const update = (patch: Partial<CloudFields>) => setState((current) => ({ ...current, ...patch }));
  return (
    <>
      <p style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.5, margin: 0 }}>{entry.credentialHelp}</p>
      <Field label="Base URL">
        <input
          className="input"
          name="cloudBaseUrl"
          value={state.baseUrl}
          onChange={(event) => update({ baseUrl: event.target.value })}
        />
      </Field>
      <Field label="Region">
        <input
          className="input"
          name="cloudRegion"
          value={state.region}
          onChange={(event) => update({ region: event.target.value })}
        />
      </Field>
      <Field label="Project / resource">
        <input
          className="input"
          name="cloudProject"
          value={state.projectId}
          onChange={(event) => update({ projectId: event.target.value })}
        />
      </Field>
      <Field label="Deployment / model id">
        <input
          className="input"
          name="cloudDeployment"
          value={state.deployment}
          onChange={(event) => update({ deployment: event.target.value })}
        />
      </Field>
      <Field label="Credential">
        <input className="input" name="secret" type="password" required autoFocus />
      </Field>
      <Field label="Default model">
        <input className="input" name="model" defaultValue={provider.model ?? entry.defaultModel ?? ""} />
      </Field>
    </>
  );
}

function composeSecret(entry: ProviderCatalogEntry, form: FormData): string {
  const raw = String(form.get("secret") ?? "").trim();
  if (entry.authType !== "cloud") return raw;
  const payload = {
    baseUrl: String(form.get("cloudBaseUrl") ?? "").trim(),
    region: String(form.get("cloudRegion") ?? "").trim(),
    projectId: String(form.get("cloudProject") ?? "").trim(),
    deployment: String(form.get("cloudDeployment") ?? "").trim(),
    secret: raw,
  };
  return JSON.stringify(payload);
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
      <ProviderLogo label={provider.label} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{provider.label}</div>
        <div style={{ fontSize: 12, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {provider.model ? `${provider.model} · ` : ""}{readableAuth(provider.authType)}{authProfile ? ` · ${authProfile.sourceType}` : ""}
        </div>
      </div>
      <ProviderHealth provider={provider} />
      <div style={{ textAlign: "right", minWidth: 120 }}>
        <div className="num mono" style={{ fontSize: 13, fontWeight: 540 }}>{boundCount} {boundCount === 1 ? "agent" : "agents"}</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>bound</div>
      </div>
      <Button onClick={onCheck}>Check</Button>
      <Button onClick={onManage}>Manage</Button>
      <Button tone="ghost" onClick={onRevoke}>Revoke</Button>
    </div>
  );
}

function ProviderHealth({ provider }: { provider: ProviderRecord }) {
  if (provider.healthState === "healthy") return <Pill tone="green">Healthy</Pill>;
  if (provider.healthState === "failed") return <Pill tone="red">Failed</Pill>;
  return <Pill>Unchecked</Pill>;
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
      <ProviderLogo label={provider.label} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{provider.label}</div>
        <div style={{ fontSize: 12, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {readableAuth(provider.authType)}
        </div>
      </div>
      <Pill>{readableAuth(provider.authType)}</Pill>
      <Button size="small" onClick={onConnect}>Connect</Button>
    </div>
  );
}

function readableAuth(authType: ProviderRecord["authType"]): string {
  if (authType === "api_key") return "API key";
  if (authType === "oauth_pkce") return "OAuth";
  if (authType === "account_subscription") return "Account";
  if (authType === "cloud") return "Cloud";
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
