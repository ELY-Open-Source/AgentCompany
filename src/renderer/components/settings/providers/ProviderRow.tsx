import { useState } from "react";
import type { CredentialSummary } from "@shared/contracts/schemas-credentials";
import type { ConnectorCatalogEntry } from "@shared/connector-catalog";
import { ApiKeyForm } from "../forms/ApiKeyForm";
import { AzureForm } from "../forms/AzureForm";
import { AwsForm } from "../forms/AwsForm";
import { VertexForm } from "../forms/VertexForm";

interface Props {
  entry: ConnectorCatalogEntry;
  credential: CredentialSummary | null;
}

const KIND_LABEL: Record<ConnectorCatalogEntry["auth"]["type"], string> = {
  oauth: "OAuth",
  api_key: "API key",
  azure: "Azure",
  aws: "AWS",
  gcp_adc: "Vertex (ADC)",
};

const STATUS_STYLE: Record<string, { dot: string; text: string }> = {
  active: { dot: "bg-emerald-400", text: "text-emerald-400" },
  expired: { dot: "bg-amber-400", text: "text-amber-400" },
  error: { dot: "bg-red-400", text: "text-red-400" },
  not_configured: { dot: "bg-muted-foreground/30", text: "text-muted-foreground" },
  revoked: { dot: "bg-muted-foreground/30", text: "text-muted-foreground" },
};

const STATUS_LABEL: Record<string, string> = {
  active: "Connected",
  expired: "Expired",
  error: "Error",
  not_configured: "Not configured",
  revoked: "Revoked",
};

const ACTION_BASE =
  "rounded px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40";
const ACTION_PRIMARY = ACTION_BASE + " bg-foreground text-background hover:opacity-90";
const ACTION_SECONDARY = ACTION_BASE + " text-muted-foreground hover:text-foreground";

export function ProviderRow({ entry, credential }: Props) {
  const [busy, setBusy] = useState<"login" | "remove" | "test" | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const status = credential?.status ?? "not_configured";
  const statusStyle = STATUS_STYLE[status] ?? STATUS_STYLE.not_configured;
  const statusLabel = STATUS_LABEL[status] ?? status;
  const hasCredential = credential !== null;

  const handleOAuthLogin = async () => {
    const desktop = window.agentCompany;
    if (!desktop) return;
    setBusy("login");
    setFeedback(null);
    const result = await desktop.startOAuth({ connectorId: entry.id });
    setBusy(null);
    if (!result.ok) setFeedback(result.error.message);
  };

  const handleRemove = async () => {
    const desktop = window.agentCompany;
    if (!desktop) return;
    setBusy("remove");
    const result = await desktop.removeCredential({ connectorId: entry.id });
    setBusy(null);
    if (!result.ok) setFeedback(result.error.message);
  };

  const handleTest = async () => {
    const desktop = window.agentCompany;
    if (!desktop) return;
    setBusy("test");
    setFeedback(null);
    const result = await desktop.testCredential({ connectorId: entry.id });
    setBusy(null);
    if (!result.ok) {
      setFeedback(result.error.message);
      return;
    }
    setFeedback(
      result.data.ok ? `OK — ${result.data.message}` : `Failed — ${result.data.message}`,
    );
  };

  const renderForm = () => {
    if (!editing || entry.auth.type === "oauth") return null;
    const onSaved = () => {
      setEditing(false);
      setFeedback("Saved.");
    };
    const apiKeyEnv = entry.auth.type === "api_key" ? entry.auth.envKey : undefined;
    if (entry.auth.type === "api_key")
      return <ApiKeyForm connectorId={entry.id} defaultEnvVar={apiKeyEnv} onSaved={onSaved} />;
    if (entry.auth.type === "azure")
      return <AzureForm connectorId={entry.id} onSaved={onSaved} />;
    if (entry.auth.type === "aws")
      return <AwsForm connectorId={entry.id} onSaved={onSaved} />;
    if (entry.auth.type === "gcp_adc")
      return <VertexForm connectorId={entry.id} onSaved={onSaved} />;
    return null;
  };

  const disabled = busy !== null;
  const isOAuth = entry.auth.type === "oauth";

  return (
    <li className="px-4 py-3 transition-colors hover:bg-muted/30">
      <div className="flex items-center gap-4">
        <span
          aria-label={`status: ${statusLabel}`}
          className={`block h-2 w-2 flex-shrink-0 rounded-full ${statusStyle.dot}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <div className="truncate text-[13px] font-semibold text-foreground">
              {entry.label}
            </div>
            <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70">
              {KIND_LABEL[entry.auth.type]}
            </div>
          </div>
          <div className={`truncate text-[11px] ${statusStyle.text}`}>
            {hasCredential ? (credential.displayHint ?? statusLabel) : statusLabel}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {isOAuth ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => void handleOAuthLogin()}
              className={hasCredential ? ACTION_SECONDARY : ACTION_PRIMARY}
            >
              {busy === "login" ? "Opening…" : hasCredential ? "Re-login" : "Login"}
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setEditing((current) => !current)}
              className={hasCredential || editing ? ACTION_SECONDARY : ACTION_PRIMARY}
            >
              {editing ? "Close" : hasCredential ? "Edit" : "Configure"}
            </button>
          )}
          {hasCredential ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => void handleTest()}
              className={ACTION_SECONDARY}
            >
              {busy === "test" ? "Testing…" : "Test"}
            </button>
          ) : null}
          {hasCredential ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => void handleRemove()}
              className={ACTION_SECONDARY}
            >
              {busy === "remove" ? "Removing…" : "Remove"}
            </button>
          ) : null}
        </div>
      </div>

      {feedback ? (
        <div className="mt-2 pl-6 text-[11px] text-muted-foreground">{feedback}</div>
      ) : null}

      {editing && !isOAuth ? (
        <div className="mt-3 rounded-md border border-border bg-background/60 p-3">
          {renderForm()}
        </div>
      ) : null}
    </li>
  );
}
