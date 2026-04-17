import { useState } from "react";
import { SignIn } from "../../ui/icons";
import type { ConnectorCatalogEntry } from "@shared/connector-catalog";
import type { CredentialSummary } from "@shared/contracts/schemas-credentials";
import type { TranslationFn } from "../../../i18n";
import {
  InlineFeedback,
  OnboardingProviderCard,
  OnboardingStatusBadge,
  type OnboardingCardStatus,
} from "./shared";

interface OAuthCardProps {
  entry: ConnectorCatalogEntry;
  credential: CredentialSummary | null;
  expanded: boolean;
  onToggle: () => void;
  t: TranslationFn;
}

export function OAuthProviderCard({
  entry,
  credential,
  expanded,
  onToggle,
  t,
}: OAuthCardProps) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const status: OnboardingCardStatus = busy
    ? "checking"
    : credential?.status ?? "not_configured";
  const connected = credential?.status === "active";

  const handleLogin = async () => {
    if (!window.agentCompany) return;
    setBusy(true);
    setFeedback(null);
    const result = await window.agentCompany.startOAuth({ connectorId: entry.id });
    setBusy(false);
    if (!result.ok) setFeedback(result.error.message);
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
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleLogin()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-muted disabled:opacity-40"
        >
          <SignIn size={14} />
          {busy
            ? t("onboarding.providers.signingIn")
            : connected
              ? t("onboarding.providers.reconnect")
              : t("onboarding.providers.signIn")}
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
      {credential?.displayHint ? (
        <div className="text-[11px] text-muted-foreground">{credential.displayHint}</div>
      ) : null}
      <InlineFeedback message={feedback} />
    </OnboardingProviderCard>
  );
}
