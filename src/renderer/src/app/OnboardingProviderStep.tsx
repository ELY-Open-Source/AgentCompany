import { Fragment, useEffect, useState } from "react";
import type { ProviderCatalogEntry } from "../../../shared/domain";
import { ProviderLogo } from "../shared/ProviderLogo";
import { ProviderOAuthConnect } from "../shared/ProviderOAuthConnect";
import { Button, Field, Pill } from "../shared/ui";
import type { Draft } from "./Onboarding";
import { t } from "../i18n/i18n";

export function ProviderStep({
  providers,
  draft,
  onChange,
  onBack,
  onNext,
}: {
  providers: ProviderCatalogEntry[];
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const selected = providers.find((entry) => entry.key === draft.providerKey) ?? providers[0];
  if (!selected) throw new Error("No provider available for onboarding.");

  return (
    <div className="form-grid">
      <h2 className="page-h1">{t("Provider")}</h2>
      <p style={{ color: "var(--text-3)", fontSize: 14 }}>
        {t("Pick the runtime for the founding CEO. You can attach more providers in Settings later.")}
      </p>
      <div className="option-grid">
        {providers.map((provider) => (
          <Fragment key={provider.key}>
            <button
              type="button"
              className={`option-card ${draft.providerKey === provider.key ? "active" : ""}`.trim()}
              onClick={() => onChange({
                providerKey: provider.key,
                providerModel: "",
                providerSecret: "",
                providerBaseUrl: "",
              })}
            >
              <div className="row" style={{ gap: 8 }}>
                <ProviderLogo providerKey={provider.key} label={provider.label} size={22} />
                <div className="opt-title" style={{ flex: 1 }}>{provider.label}</div>
                <Pill tone="violet">{authBadge(provider.authType)}</Pill>
              </div>
              <div className="opt-sub">{provider.capabilityTags.join(" · ") || authBadge(provider.authType)}</div>
            </button>
            {provider.key === selected.key && (
              <ProviderCredentialFields selected={selected} draft={draft} onChange={onChange} />
            )}
          </Fragment>
        ))}
      </div>
      <Actions onBack={onBack} onNext={onNext} />
    </div>
  );
}

function ProviderCredentialFields({
  selected,
  draft,
  onChange,
}: {
  selected: ProviderCatalogEntry;
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const isOAuthLike = selected.authType === "oauth_pkce" || selected.authType === "account_subscription";
  const isCustom = Boolean(selected.customEndpoint);
  const live = selected.supportsLiveModels;
  const [fetched, setFetched] = useState<ProviderCatalogEntry["models"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const hasCredential = isOAuthLike
    ? Boolean(draft.providerSecret.trim())
    : isCustom
      ? Boolean(draft.providerBaseUrl.trim() && draft.providerSecret.trim())
      : Boolean(draft.providerSecret.trim());

  const loadModels = async (secret: string) => {
    setLoading(true);
    setLoadError(null);
    const result = await window.agentCompany.listProviderModels({ providerKey: selected.key, secret });
    setLoading(false);
    if (!result.ok) {
      setLoadError(result.error.message);
      return;
    }
    setFetched(result.data);
    if (result.data[0]) onChange({ providerModel: result.data[0].id });
  };

  const loadTypedModels = () => {
    const secret = isCustom
      ? JSON.stringify({ baseUrl: draft.providerBaseUrl.trim(), secret: draft.providerSecret.trim() })
      : draft.providerSecret.trim();
    void loadModels(secret);
  };

  const showCuratedList = !live && hasCredential && selected.models.length > 0;
  useEffect(() => {
    if (showCuratedList && !draft.providerModel) {
      onChange({ providerModel: selected.defaultModel ?? selected.models[0].id });
    }
  }, [showCuratedList, draft.providerModel, selected, onChange]);

  return (
    <div className="provider-inline-form">
      {selected.credentialHelp && (
        <div style={{ fontSize: 13, color: "var(--text-3)", lineHeight: 1.5 }}>{selected.credentialHelp}</div>
      )}
      {isOAuthLike ? (
        <ProviderOAuthConnect
          key={selected.key}
          providerKey={selected.key}
          label={selected.label}
          buildInput={() => ({ providerKey: selected.key })}
          onComplete={(secret) => {
            onChange({ providerSecret: secret ?? "" });
            if (secret && live) void loadModels(secret);
          }}
        />
      ) : isCustom ? (
        <>
          <Field label={t("Base URL")}>
            <input
              className="input"
              value={draft.providerBaseUrl}
              onChange={(event) => onChange({ providerBaseUrl: event.target.value })}
            />
          </Field>
          <Field label={t("API key")}>
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={draft.providerSecret}
              onChange={(event) => onChange({ providerSecret: event.target.value })}
            />
          </Field>
        </>
      ) : (
        <Field label={t("API key")}>
          <input
            className="input"
            type="password"
            autoComplete="off"
            value={draft.providerSecret}
            onChange={(event) => onChange({ providerSecret: event.target.value, providerModel: "" })}
          />
        </Field>
      )}
      {!isOAuthLike && live && (
        <Button tone="ghost" onClick={loadTypedModels} disabled={!hasCredential || loading}>
          {loading ? t("Getting models...") : fetched ? t("Reload models") : t("Get models")}
        </Button>
      )}
      {loadError && <div style={{ color: "var(--red)", fontSize: 12 }}>{loadError}</div>}
      {(hasCredential || isCustom) && (
        <Field label={t("Model")}>
          {fetched || showCuratedList ? (
            <select
              className="input"
              value={draft.providerModel}
              onChange={(event) => onChange({ providerModel: event.target.value })}
            >
              {(fetched ?? selected.models).map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              value={draft.providerModel}
              onChange={(event) => onChange({ providerModel: event.target.value })}
            />
          )}
        </Field>
      )}
    </div>
  );
}

function Actions({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="modal-actions" style={{ marginTop: 4 }}>
      <Button onClick={onBack}>{t("Back")}</Button>
      <Button tone="primary" onClick={onNext}>{t("Continue")}</Button>
    </div>
  );
}

function authBadge(authType: string): string {
  if (authType === "api_key") return t("API key");
  if (authType === "oauth_pkce") return t("OAuth");
  if (authType === "account_subscription") return t("Account");
  if (authType === "cloud") return t("Cloud");
  return authType;
}
