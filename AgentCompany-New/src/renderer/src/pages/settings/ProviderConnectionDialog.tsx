import { useState } from "react";
import type { ProviderCatalogEntry, ProviderRecord } from "../../../../shared/domain";
import { ProviderOAuthConnect } from "../../shared/ProviderOAuthConnect";
import { Field } from "../../shared/ui";

interface CloudFields {
  baseUrl: string;
  region: string;
  projectId: string;
  deployment: string;
}

const CLOUD_DEFAULTS: CloudFields = { baseUrl: "", region: "", projectId: "", deployment: "" };

export function ProviderConnectFields({
  provider,
  entry,
}: {
  provider: ProviderRecord;
  entry: ProviderCatalogEntry;
}) {
  if (entry.authType === "api_key") {
    return (
      <>
        <p style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5, margin: 0 }}>{entry.credentialHelp}</p>
        <Field label="API key"><input className="input" name="secret" type="password" required autoFocus /></Field>
        <ModelPicker entry={entry} provider={provider} />
      </>
    );
  }
  if (entry.customEndpoint) {
    return <CompatFieldsForm entry={entry} provider={provider} />;
  }
  return <CloudFieldsForm entry={entry} provider={provider} />;
}

export function ProviderOAuthFields({
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
      <p style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5, margin: 0 }}>{entry.credentialHelp}</p>
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

function CompatFieldsForm({ entry, provider }: { entry: ProviderCatalogEntry; provider: ProviderRecord }) {
  const [baseUrl, setBaseUrl] = useState("");
  return (
    <>
      <p style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5, margin: 0 }}>{entry.credentialHelp}</p>
      <Field label="Base URL">
        <input
          className="input"
          name="cloudBaseUrl"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </Field>
      <Field label="API key"><input className="input" name="secret" type="password" required /></Field>
      <ModelPicker entry={entry} provider={provider} />
    </>
  );
}

function ModelPicker({ entry, provider }: { entry: ProviderCatalogEntry; provider: ProviderRecord }) {
  const [fetched, setFetched] = useState<ProviderCatalogEntry["models"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(provider.model ?? entry.defaultModel ?? entry.models[0]?.id ?? "");
  const models = fetched ?? entry.models;
  const connected = entry.supportsLiveModels && Boolean(provider.credentialId) && provider.enabled && provider.authState === "configured";

  const refresh = async () => {
    setLoading(true);
    setError(null);
    const result = await window.agentCompany.listProviderModels({ providerKey: entry.key, orgId: provider.orgId, providerId: provider.id });
    setLoading(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setFetched(result.data);
    if (result.data[0] && !result.data.some((model) => model.id === value)) setValue(result.data[0].id);
  };

  return (
    <Field label="Default model">
      {models.length ? (
        <select className="input" name="model" value={value} onChange={(event) => setValue(event.target.value)}>
          {models.map((model) => (
            <option key={model.id} value={model.id}>{model.name}</option>
          ))}
        </select>
      ) : (
        <input className="input" name="model" value={value} onChange={(event) => setValue(event.target.value)} />
      )}
      {connected && (
        <button type="button" className="button ghost" style={{ marginTop: 6 }} disabled={loading} onClick={refresh}>
          {loading ? "Loading models..." : "Refresh models"}
        </button>
      )}
      {error && <div style={{ color: "var(--red)", fontSize: 12, marginTop: 4 }}>{error}</div>}
    </Field>
  );
}

function CloudFieldsForm({ entry, provider }: { entry: ProviderCatalogEntry; provider: ProviderRecord }) {
  const [state, setState] = useState<CloudFields>(CLOUD_DEFAULTS);
  const update = (patch: Partial<CloudFields>) => setState((current) => ({ ...current, ...patch }));
  return (
    <>
      <p style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5, margin: 0 }}>{entry.credentialHelp}</p>
      <Field label="Base URL">
        <input className="input" name="cloudBaseUrl" value={state.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} />
      </Field>
      <Field label="Region">
        <input className="input" name="cloudRegion" value={state.region} onChange={(event) => update({ region: event.target.value })} />
      </Field>
      <Field label="Project / resource">
        <input className="input" name="cloudProject" value={state.projectId} onChange={(event) => update({ projectId: event.target.value })} />
      </Field>
      <Field label="Deployment / model id">
        <input className="input" name="cloudDeployment" value={state.deployment} onChange={(event) => update({ deployment: event.target.value })} />
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
