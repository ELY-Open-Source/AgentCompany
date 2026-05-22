import { useState, type FormEvent } from "react";
import { Button, Field, Pill } from "../../shared/ui";
import { Dialog } from "../../shared/Dialog";
import type { AgentRecord, ProviderRecord } from "../../../../shared/domain";
import { ProviderLogo } from "./ProviderLogo";
import type { SnapshotActions } from "../../app/useSnapshot";

interface ProvidersPanelProps {
  orgId: string;
  providers: ProviderRecord[];
  agents: AgentRecord[];
  actions: SnapshotActions;
}

export function ProvidersPanel({ orgId, providers, agents, actions }: ProvidersPanelProps) {
  const [active, setActive] = useState<ProviderRecord | null>(null);
  const connected = providers.filter((provider) => provider.enabled);
  const available = providers.filter((provider) => !provider.enabled);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!active) return;
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.saveProviderCredential({
      orgId,
      providerId: active.id,
      secret: String(form.get("secret") ?? "").trim(),
      model: String(form.get("model") ?? "").trim() || null,
    })).then((result) => { if (result) setActive(null); });
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
                agents={agents}
                onManage={() => setActive(provider)}
              />
            ))}
          </div>
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

      <Dialog title="Provider credential" open={Boolean(active)} submitLabel="Save" onClose={() => setActive(null)} onSubmit={save}>
        <Field label="Provider"><input className="input" value={active?.label ?? ""} readOnly /></Field>
        <Field label="Auth type"><input className="input" value={active ? readableAuth(active.authType) : ""} readOnly /></Field>
        <Field label="Secret"><input className="input" name="secret" type="password" required autoFocus /></Field>
        <Field label="Default model"><input className="input" name="model" defaultValue={active?.model ?? ""} placeholder="Optional" /></Field>
      </Dialog>
    </div>
  );
}

function ProviderRow({
  provider,
  agents,
  onManage,
}: {
  provider: ProviderRecord;
  agents: AgentRecord[];
  onManage: () => void;
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
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>
          {provider.model ? `${provider.model} · ` : ""}{readableAuth(provider.authType)}
        </div>
      </div>
      <div style={{ textAlign: "right", minWidth: 120 }}>
        <div className="num mono" style={{ fontSize: 13, fontWeight: 540 }}>{boundCount} {boundCount === 1 ? "agent" : "agents"}</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>bound</div>
      </div>
      <Button onClick={onManage}>Manage</Button>
    </div>
  );
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
