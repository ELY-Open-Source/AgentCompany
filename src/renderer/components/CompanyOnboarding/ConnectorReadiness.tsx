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
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">
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
                <span className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[color:var(--muted)] border-t-[color:var(--accent)]" />
              ) : isReady ? (
                <CheckCircle size={16} weight="fill" className="shrink-0 text-[color:var(--success)]" />
              ) : isMissing ? (
                <XCircle size={16} weight="fill" className="shrink-0 text-[color:var(--muted)]" />
              ) : (
                <WarningCircle size={16} weight="fill" className="shrink-0 text-[color:var(--warn)]" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={isReady ? "font-medium text-[color:var(--text)]" : isChecking ? "text-[color:var(--text)]" : "text-[color:var(--muted)]"}>
                    {connector.label}
                  </span>
                  <span className="text-[11px] text-[color:var(--muted)]">
                    {isChecking ? (currentLocale === "zh" ? "检测中..." : "checking...") : connector.status.replaceAll("_", " ")}
                  </span>
                </div>
                {issue ? (
                  <div className="mt-0.5 text-[11px] leading-relaxed text-[color:var(--muted)]">
                    {issue}
                  </div>
                ) : null}
              </div>
              {connector.id === "claude_local" ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpenClaudeSettings(); }}
                  className="shrink-0 rounded-[6px] p-1.5 text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"
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
        <div className="mt-4 rounded-[8px] border border-[color:var(--warn)] bg-[color:var(--warn-soft)] px-4 py-3 text-[12px] text-[color:var(--warn)]">
          {t("onboarding.connectorWarning")}
        </div>
      ) : null}
    </div>
  );
}
