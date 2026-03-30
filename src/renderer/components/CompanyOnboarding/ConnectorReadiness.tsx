import {
  CheckCircle,
  GearSix,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { getConnectorExecutionReadinessIssue } from "@shared/connector-policy";
import type { ProfileSnapshot } from "@shared/types";
import type { AppLocale } from "@shared/locale";

interface ConnectorReadinessProps {
  connectors: ProfileSnapshot["connectors"];
  currentLocale: AppLocale;
  hasRunnableConnector: boolean;
  onOpenClaudeSettings: () => void;
  t: (key: string) => string;
}

export function ConnectorReadiness({
  connectors,
  currentLocale,
  hasRunnableConnector,
  onOpenClaudeSettings,
  t,
}: ConnectorReadinessProps) {
  return (
    <div className="mt-10">
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t("onboarding.connectorReadiness")}
      </div>
      <div className="space-y-2.5">
        {connectors.map((connector) => {
          const isChecking = connector.status === "detected";
          const isReady = connector.status === "ready";
          const isMissing = connector.status === "not_installed";
          const issue = !isChecking ? getConnectorExecutionReadinessIssue(connector) : null;
          return (
            <div key={connector.id} className="flex items-start gap-2.5 text-[13px]">
              {isChecking ? (
                <span className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[color:var(--muted-foreground)] border-t-[color:var(--primary)]" />
              ) : isReady ? (
                <CheckCircle size={16} weight="fill" className="shrink-0 text-success" />
              ) : isMissing ? (
                <XCircle size={16} weight="fill" className="shrink-0 text-muted-foreground" />
              ) : (
                <WarningCircle size={16} weight="fill" className="shrink-0 text-warning" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={isReady ? "font-medium text-foreground" : isChecking ? "text-foreground" : "text-muted-foreground"}>
                    {connector.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {isChecking ? (currentLocale === "zh" ? "检测中..." : "checking...") : connector.status.replaceAll("_", " ")}
                  </span>
                </div>
                {issue ? (
                  <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {issue}
                  </div>
                ) : null}
              </div>
              {connector.id === "claude_local" ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpenClaudeSettings(); }}
                  className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  title={currentLocale === "zh" ? "Claude Code 设置" : "Claude Code Settings"}
                >
                  <GearSix size={14} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {!hasRunnableConnector ? (
        <div className="mt-4 rounded-lg border border-[color:var(--destructive)] bg-warning-muted px-4 py-3 text-[12px] text-warning">
          {t("onboarding.connectorWarning")}
        </div>
      ) : null}
    </div>
  );
}
