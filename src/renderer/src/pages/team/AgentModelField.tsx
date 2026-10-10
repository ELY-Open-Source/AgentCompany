import { useEffect, useState } from "react";
import type { ProviderCatalogEntry, ProviderRecord } from "../../../../shared/domain";
import type { ProviderModelEntry } from "../../../../shared/provider-models";
import { Field } from "../../shared/ui";
import { t } from "../../i18n/i18n";

type Fetched = { providerId: string; models: ProviderModelEntry[] } | { providerId: string; error: string };

/** An agent's model: the provider's whole list (live from a connected provider, else its catalog), blank meaning the provider's default. */
export function AgentModelField({ provider, entry, value, onChange }: {
  provider: ProviderRecord | null;
  entry: ProviderCatalogEntry | null;
  value: string;
  onChange: (model: string) => void;
}) {
  const live = Boolean(provider && entry?.supportsLiveModels && provider.credentialId && provider.enabled && provider.authState === "configured");
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const providerId = provider?.id ?? null;
  const providerKey = provider?.providerKey ?? null;
  const orgId = provider?.orgId ?? null;

  useEffect(() => {
    if (!live || !providerId || !providerKey || !orgId) return;
    let current = true;
    void window.agentCompany.listProviderModels({ providerKey, orgId, providerId }).then((result) => {
      if (!current) return;
      setFetched(result.ok ? { providerId, models: result.data } : { providerId, error: result.error.message });
    });
    return () => {
      current = false;
    };
  }, [live, providerId, providerKey, orgId]);

  const mine = fetched && fetched.providerId === providerId ? fetched : null;
  const models = mine && "models" in mine ? mine.models : entry?.models ?? [];
  const known = models.some((model) => model.id === value);

  return (
    <>
    <Field label={t("Model")}>
      {!provider || models.length === 0 ? (
        <input className="input" name="modelId" value={value} disabled={!provider} placeholder={provider?.model ?? ""} onChange={(event) => onChange(event.currentTarget.value)} />
      ) : (
        <select className="input" name="modelId" value={value} onChange={(event) => onChange(event.currentTarget.value)}>
          <option value="">{t("{model} (provider default)", { model: provider.model ?? "" })}</option>
          {value && !known && <option value={value}>{value}</option>}
          {models.map((model) => <option key={model.id} value={model.id}>{model.name === model.id ? model.id : `${model.name} · ${model.id}`}</option>)}
        </select>
      )}
    </Field>
    {live && !mine && <div style={{ color: "var(--text-3)" }}>{t("Loading models...")}</div>}
    {mine && "error" in mine && <div className="form-error" role="alert">{mine.error}</div>}
    </>
  );
}
