import { useEffect, useState } from "react";
import { FloppyDisk } from "../../ui/icons";
import type { ConnectorCatalogEntry } from "@shared/connector-catalog";
import type { CredentialSummary } from "@shared/contracts/schemas-credentials";
import type { TranslationFn } from "../../../i18n";
import {
  InlineFeedback,
  OnboardingProviderCard,
  OnboardingStatusBadge,
  type OnboardingCardStatus,
} from "./shared";
import { Input } from "../../ui";

interface LocalProviderCardProps {
  entry: ConnectorCatalogEntry;
  credential: CredentialSummary | null;
  expanded: boolean;
  onToggle: () => void;
  t: TranslationFn;
}

/**
 * Onboarding card for local OpenAI-compatible servers (Ollama, LM Studio).
 *
 * The catalog supplies a sensible default URL per entry; the user can
 * override it to point at a non-default port, a remote machine, or a
 * reverse proxy. The card never asks for an API key — local servers
 * accept any bearer value, so the credential resolver supplies the
 * connector id as a non-empty placeholder for the OpenAI SDK.
 */
export function LocalProviderCard({
  entry,
  credential,
  expanded,
  onToggle,
  t,
}: LocalProviderCardProps) {
  if (entry.auth.type !== "local") {
    throw new Error(`LocalProviderCard received non-local connector: ${entry.id}`);
  }
  const defaultBaseUrl = entry.auth.defaultBaseUrl;
  const initialBaseUrl = credential?.displayHint?.startsWith("local:")
    ? credential.displayHint.slice("local:".length)
    : defaultBaseUrl;
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const next = credential?.displayHint?.startsWith("local:")
      ? credential.displayHint.slice("local:".length)
      : defaultBaseUrl;
    setBaseUrl(next);
  }, [credential?.displayHint, defaultBaseUrl]);

  const status: OnboardingCardStatus = busy
    ? "checking"
    : credential?.status ?? "not_configured";
  const connected = credential?.status === "active";

  const handleSave = async () => {
    if (!window.agentCompany) return;
    const trimmed = baseUrl.trim();
    if (trimmed.length === 0) {
      setFeedback(t("onboarding.providers.baseUrlRequired"));
      return;
    }
    try {
      new URL(trimmed);
    } catch {
      setFeedback(t("onboarding.providers.baseUrlInvalid"));
      return;
    }
    setBusy(true);
    setFeedback(null);
    const result = await window.agentCompany.saveCredential({
      connectorId: entry.id,
      payload: {
        kind: "local",
        value: { baseUrl: trimmed },
      },
    });
    setBusy(false);
    if (!result.ok) {
      setFeedback(result.error.message);
      return;
    }
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
            {t("onboarding.providers.baseUrlLabel")}{" "}
            <span className="font-mono text-[11px] text-muted-foreground/70">({defaultBaseUrl})</span>
          </label>
          <Input
            type="text"
            value={baseUrl}
            onChange={setBaseUrl}
            placeholder={defaultBaseUrl}
            disabled={busy}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy || baseUrl.trim().length === 0}
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
      <InlineFeedback message={feedback} />
    </OnboardingProviderCard>
  );
}
