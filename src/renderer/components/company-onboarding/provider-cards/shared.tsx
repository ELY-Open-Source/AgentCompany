import { CaretDown, CaretRight } from "../../ui/icons";
import type { ReactNode } from "react";
import type { CredentialSummary } from "@shared/contracts/schemas-credentials";
import type { TranslationFn } from "../../../i18n";
import { Card } from "../../ui";

export type OnboardingCardStatus = CredentialSummary["status"] | "checking" | "not_configured";

export function OnboardingProviderCard({
  label,
  description,
  badge,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  description: string;
  badge: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Card padding="none" className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-start justify-between gap-3 px-4 py-3 text-left transition hover:bg-muted/40"
      >
        <div className="flex min-w-0 items-start gap-2.5">
          {expanded ? (
            <CaretDown size={14} className="mt-1 flex-shrink-0 text-muted-foreground" />
          ) : (
            <CaretRight size={14} className="mt-1 flex-shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-foreground">{label}</div>
            <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground line-clamp-2">
              {description}
            </div>
          </div>
        </div>
        <div className="flex-shrink-0 pt-0.5">{badge}</div>
      </button>
      {expanded ? <div className="space-y-3 px-4 pb-4">{children}</div> : null}
    </Card>
  );
}

export function OnboardingStatusBadge({
  status,
  t,
}: {
  status: OnboardingCardStatus;
  t: TranslationFn;
}) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success-muted px-2 py-0.5 text-[11px] font-medium text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        {t("onboarding.providers.statusReady")}
      </span>
    );
  }
  if (status === "expired") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-muted px-2 py-0.5 text-[11px] font-medium text-warning">
        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        {t("onboarding.providers.statusExpired")}
      </span>
    );
  }
  if (status === "error" || status === "revoked") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-caution-muted px-2 py-0.5 text-[11px] font-medium text-caution">
        <span className="h-1.5 w-1.5 rounded-full bg-caution" />
        {t("onboarding.providers.statusError")}
      </span>
    );
  }
  if (status === "checking") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-muted-foreground border-t-primary" />
        {t("onboarding.providers.statusChecking")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
      {t("onboarding.providers.statusNotConfigured")}
    </span>
  );
}

export function InlineFeedback({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="pt-1 text-[11px] leading-relaxed text-muted-foreground">{message}</div>;
}
