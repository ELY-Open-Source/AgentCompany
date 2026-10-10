import { useUnsaved } from "../../shared/unsaved";
import { credentialSourceLabel } from "../../i18n/labels";
import { defaultModelReach } from "../../../../shared/agent-model";
import { ScopeNote } from "./ScopeNote";
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
import { ProviderLogo } from "../../shared/ProviderLogo";
import { ModelPicker, ProviderConnectFields, ProviderOAuthFields } from "./ProviderConnectionDialog";
import { composeSecret } from "./provider-secret";
import { ProviderPolicyTable } from "./ProviderPolicyTable";
import { DisconnectProviderDialog } from "./DisconnectProviderDialog";
import type { SnapshotActions } from "../../app/useSnapshot";

interface ProvidersPanelProps {
  companyName: string;
  orgId: string;
  employeeId: string;
  providers: ProviderRecord[];
  authProfiles: ProviderAuthProfileRecord[];
  catalog: ProviderCatalogEntry[];
  agents: AgentRecord[];
  providerRateLimits: ProviderRateLimitStateRecord[];
  actions: SnapshotActions;
}

const PRICE_GRID = "minmax(150px, 1.4fr) 110px 110px 110px 92px";

export function ProvidersPanel({ orgId, companyName, employeeId, providers, authProfiles, catalog, agents, providerRateLimits, actions }: ProvidersPanelProps) {
  const [active, setActive] = useState<ProviderRecord | null>(null);
  const [modelFor, setModelFor] = useState<ProviderRecord | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<ProviderRecord | null>(null);
  const openModel = (provider: ProviderRecord | null) => { setModelError(null); setModelFor(provider); };
  const modelForEntry = modelFor ? requireCatalogEntry(catalog, modelFor.providerKey) : null;
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
    return actions.run(() => window.agentCompany.saveProviderCredential({
      orgId,
      providerId: active.id,
      secret,
      model: String(form.get("model") ?? "").trim() || null,
    })).then((result) => { if (result) close(); });
  };

  const saveModel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!modelFor) return;
    const model = String(new FormData(event.currentTarget).get("model") ?? "");
    setModelError(null);
    return actions.run(() => window.agentCompany.setProviderModel({ orgId, providerId: modelFor.id, model }))
      .then((result) => { if (result) setModelFor(null); })
      .catch((reason: unknown) => setModelError(reason instanceof Error ? reason.message : String(reason)));
  };

  return (
    <div className="page">
      <h1 className="page-h1">{t("Providers")}</h1>
      <ScopeNote scope="company" company={companyName} />

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
                onChangeModel={provider.providerKey === "azure-openai" ? null : () => openModel(provider)}
                onRevoke={() => setDisconnecting(provider)}
              />
            ))}
          </div>
          <ProviderPolicyTable
            orgId={orgId}
            providers={connected}
            providerRateLimits={providerRateLimits}
            actions={actions}
          />
          <ProviderPricesTable orgId={orgId} providers={connected} actions={actions} />
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
        {active && (
          <p style={{ fontSize: "var(--fs-body)", color: "var(--text-3)", margin: 0 }}>
            {t("The default model reaches {following} agents without their own model; {own} keep their own. Sessions already started keep the model they began with.", { following: defaultModelReach(agents, active.id).following, own: defaultModelReach(agents, active.id).ownModel })}
          </p>
        )}
      </Dialog>

      {disconnecting && (
        <DisconnectProviderDialog
          key={disconnecting.id}
          orgId={orgId}
          provider={disconnecting}
          actions={actions}
          onClose={() => setDisconnecting(null)}
        />
      )}

      {/* Only the model changes here: the credential and its sign-in stay as they are. */}
      <Dialog
        key={modelFor?.id ?? "none"}
        title={modelFor ? t("Default model for {label}", { label: modelFor.label }) : ""}
        open={Boolean(modelFor)}
        submitLabel={t("Save")}
        onClose={() => openModel(null)}
        onSubmit={saveModel}
      >
        {modelFor && modelForEntry && (
          <>
            <ModelPicker entry={modelForEntry} provider={modelFor} />
            {modelError && <div className="form-error" role="alert">{modelError}</div>}
            <p style={{ fontSize: "var(--fs-body)", color: "var(--text-3)", margin: 0 }}>
            {t("The default model reaches {following} agents without their own model; {own} keep their own. Sessions already started keep the model they began with.", { following: defaultModelReach(agents, modelFor.id).following, own: defaultModelReach(agents, modelFor.id).ownModel })}
          </p>
          </>
        )}
      </Dialog>
    </div>
  );
}

/** Prices turn recorded token usage into spend, which agent and department budgets are checked against. */
function ProviderPricesTable({ orgId, providers, actions }: { orgId: string; providers: ProviderRecord[]; actions: SnapshotActions }) {
  return (
    <>
      <div className="section-label" style={{ marginBottom: 10 }}>{t("Prices (US$ per million tokens)")}</div>
      <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 28 }}>
        <div className="table-row head" style={{ gridTemplateColumns: PRICE_GRID, minWidth: 640 }}>
          <div>{t("Provider")}</div><div>{t("Input")}</div><div>{t("Cached input")}</div><div>{t("Output")}</div><div />
        </div>
        {providers.map((provider) => <ProviderPricesRow key={provider.id} orgId={orgId} provider={provider} actions={actions} />)}
      </div>
    </>
  );
}

function ProviderPricesRow({ orgId, provider, actions }: { orgId: string; provider: ProviderRecord; actions: SnapshotActions }) {
  const asDollars = (cents: number | null) => (cents === null ? "" : String(cents / 100));
  const [input, setInput] = useState(asDollars(provider.inputCentsPerMtok));
  const [cached, setCached] = useState(asDollars(provider.cachedInputCentsPerMtok));
  const [output, setOutput] = useState(asDollars(provider.outputCentsPerMtok));
  const [error, setError] = useState<string | null>(null);
  const price = (value: string) => (value.trim() === "" ? null : Number(value));
  const saved = (cents: number | null) => (cents === null ? null : cents / 100);
  useUnsaved(price(input) !== saved(provider.inputCentsPerMtok) || price(cached) !== saved(provider.cachedInputCentsPerMtok) || price(output) !== saved(provider.outputCentsPerMtok));
  const save = () => {
    setError(null);
    actions.run(() => window.agentCompany.setProviderPrices({
      orgId, providerId: provider.id, inputDollarsPerMtok: price(input), cachedInputDollarsPerMtok: price(cached), outputDollarsPerMtok: price(output),
    })).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
  };
  const field = (label: string, value: string, onChange: (next: string) => void) => (
    <input className="input" aria-label={t("{label} {kind} price", { label: provider.label, kind: label })} type="number" min={0} step="0.01" value={value} onChange={(event) => onChange(event.target.value)} />
  );
  return (
    <div className="table-row" style={{ gridTemplateColumns: PRICE_GRID, minWidth: 640 }}>
      <div>{provider.label}{provider.inputCentsPerMtok === null && <div style={{ fontSize: "var(--fs-body)", color: "var(--text-3)" }}>{t("Unpriced: spend is not counted")}</div>}</div>
      {field(t("input"), input, setInput)}
      {field(t("cached input"), cached, setCached)}
      {field(t("output"), output, setOutput)}
      <div>
        <button type="button" className="button small" aria-label={t("Save {label} prices", { label: provider.label })} onClick={save}>{t("Save")}</button>
        {error && <div className="form-error" role="alert">{error}</div>}
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
  onChangeModel,
  onRevoke,
}: {
  provider: ProviderRecord;
  authProfile: ProviderAuthProfileRecord | null;
  agents: AgentRecord[];
  onCheck: () => void;
  onManage: () => void;
  /** Null where the model lives in the credential (Azure's deployment). */
  onChangeModel: (() => void) | null;
  onRevoke: () => void;
}) {
  const boundCount = agents.filter((agent) => agent.modelProviderId === provider.id).length;
  return (
    <div
      data-object-id={provider.id}
      className="reveal-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: 14,
        background: "var(--panel)",
        border: "1px solid var(--border)",
      }}
    >
      <ProviderLogo providerKey={provider.providerKey} label={provider.label} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--fs-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{provider.label}</div>
        <div style={{ fontSize: "var(--fs-body)", color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {provider.model ? `${provider.model} · ` : ""}{readableAuth(provider.authType)}{authProfile ? ` · ${credentialSourceLabel(authProfile.sourceType)}` : ""}
        </div>
      </div>
      <ProviderHealth provider={provider} />
      <div className="num mono" style={{ fontSize: "var(--fs-body)", minWidth: 72, textAlign: "right" }}>
        {boundCount === 1 ? t("{count} agent", { count: boundCount }) : t("{count} agents", { count: boundCount })}
      </div>
      <span className="reveal row" style={{ gap: 6 }}>
        <Button onClick={onCheck}>{t("Check")}</Button>
        {onChangeModel && <Button onClick={onChangeModel}>{t("Change model")}</Button>}
        <Button onClick={onManage}>{t("Manage")}</Button>
        <Button
          tone="ghost"
          onClick={onRevoke}
          title={t("Erases the key from this computer. {provider} keeps accepting it until you revoke it in your account.", { provider: provider.label })}
        >
          {t("Disconnect")}
        </Button>
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
      data-object-id={provider.id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 14,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        minWidth: 0,
      }}
    >
      <ProviderLogo providerKey={provider.providerKey} label={provider.label} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--fs-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{provider.label}</div>
        <div style={{ fontSize: "var(--fs-body)", color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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

function requireCatalogEntry(catalog: ProviderCatalogEntry[], providerKey: string): ProviderCatalogEntry {
  const entry = catalog.find((candidate) => candidate.key === providerKey);
  if (!entry) throw new Error(`Provider ${providerKey} is not in the catalog.`);
  return entry;
}
