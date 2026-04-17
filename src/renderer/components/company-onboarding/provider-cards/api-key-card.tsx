import { useState } from "react";
import { FloppyDisk } from "../../ui/icons";
import type { ConnectorCatalogEntry } from "@shared/connector-catalog";
import type { CredentialSummary } from "@shared/contracts/schemas-credentials";
import type { TranslationFn } from "../../../i18n";
import {
  INPUT_CLS,
  InlineFeedback,
  OnboardingProviderCard,
  OnboardingStatusBadge,
  type OnboardingCardStatus,
} from "./shared";

interface ApiKeyCardProps {
  entry: ConnectorCatalogEntry;
  credential: CredentialSummary | null;
  expanded: boolean;
  onToggle: () => void;
  t: TranslationFn;
}

export function ApiKeyProviderCard({
  entry,
  credential,
  expanded,
  onToggle,
  t,
}: ApiKeyCardProps) {
  if (entry.auth.type !== "api_key") {
    throw new Error(`ApiKeyProviderCard received non-api_key connector: ${entry.id}`);
  }
  const envKey = entry.auth.envKey;
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const status: OnboardingCardStatus = busy
    ? "checking"
    : credential?.status ?? "not_configured";
  const connected = credential?.status === "active";

  const handleSave = async () => {
    if (!window.agentCompany) return;
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setFeedback(t("onboarding.providers.apiKeyRequired"));
      return;
    }
    setBusy(true);
    setFeedback(null);
    const result = await window.agentCompany.saveCredential({
      connectorId: entry.id,
      payload: {
        kind: "api_key",
        value: { source: "literal", value: trimmed },
      },
    });
    setBusy(false);
    if (!result.ok) {
      setFeedback(result.error.message);
      return;
    }
    setValue("");
    setFeedback(t("onboarding.providers.saved"));
  };

  const handleRemove = async () => {
    if (!window.agentCompany) return;
    setBusy(true);
    setFeedback(null);
    const result = await window.agentCompany.removeCredential({ connectorId: entry.id });
    setBusy(false);
    if (!result.ok) setFeedback(result.error.message);
  };

  return (
    <OnboardingProviderCard
      label={entry.label}
      description={entry.description}
      badge={<OnboardingStatusBadge status={status} t={t} />}
      expanded={expanded}
      onToggle={onToggle}
    >
      {entry.notes ? (
        <div className="text-[12px] leading-relaxed text-muted-foreground">{entry.notes}</div>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
        className="space-y-3"
      >
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
            {t("onboarding.providers.apiKeyLabel")}{" "}
            <span className="font-mono text-[11px] text-muted-foreground/70">({envKey})</span>
          </label>
          <input
            type="password"
            className={INPUT_CLS}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={connected ? t("onboarding.providers.apiKeyReplacePlaceholder") : ""}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy || value.trim().length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-muted disabled:opacity-40"
          >
            <FloppyDisk size={14} />
            {busy ? t("onboarding.providers.saving") : t("onboarding.providers.save")}
          </button>
          {connected ? (
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={busy}
              className="text-[12px] text-muted-foreground transition hover:text-destructive disabled:opacity-40"
            >
              {t("onboarding.providers.disconnect")}
            </button>
          ) : null}
        </div>
      </form>
      {credential?.displayHint ? (
        <div className="text-[11px] text-muted-foreground">{credential.displayHint}</div>
      ) : null}
      <InlineFeedback message={feedback} />
    </OnboardingProviderCard>
  );
}
