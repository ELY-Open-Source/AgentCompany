import { Button, IconButton, Pill } from "../../shared/ui";
import type { AgentRecord, ConnectorAccountRecord, ConnectorGrantRecord } from "../../../../shared/domain";
import { ToolkitTile } from "./ToolkitCatalog";
import { t } from "../../i18n/i18n";

const STATUS_TONE: Record<string, "green" | "amber" | "red" | undefined> = {
  ACTIVE: "green",
  INITIATED: "amber",
  INITIALIZING: "amber",
  FAILED: "red",
  EXPIRED: "red",
  REVOKED: "red",
  INACTIVE: "red",
};

/**
 * The company's connected toolkits, each with the roster of agents the CEO
 * has granted access to. Grants are the CEO's call — made with its
 * grant_connector tool — so the roster here is read-only. Reconnect restarts
 * the link flow for the toolkit; delete removes the connection entirely.
 */
export function ConnectedList({
  accounts,
  grants,
  agents,
  logoBySlug,
  busySlug,
  busyAction,
  onReconnect,
  onDelete,
}: {
  accounts: ConnectorAccountRecord[];
  grants: ConnectorGrantRecord[];
  agents: AgentRecord[];
  logoBySlug: Map<string, string | null>;
  busySlug: string | null;
  busyAction: "connect" | "disconnect" | null;
  onReconnect: (toolkitSlug: string) => void;
  onDelete: (toolkitSlug: string) => void;
}) {
  if (accounts.length === 0) return null;
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
  return (
    <section style={{ marginBottom: 24 }}>
      <div className="section-label" style={{ marginBottom: 12 }}>{t("Connected")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {accounts.map((account) => {
          const holders = grants
            .filter((grant) => grant.toolkitSlug === account.toolkitSlug)
            .map((grant) => agentNames.get(grant.agentId))
            .filter((name): name is string => Boolean(name));
          const busy = busySlug !== null;
          return (
            <div key={account.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, background: "var(--panel)" }}>
              <div className="row" style={{ gap: 10 }}>
                <ToolkitTile
                  name={account.toolkitName}
                  slug={account.toolkitSlug}
                  logoUrl={logoBySlug.get(account.toolkitSlug) ?? null}
                  size={30}
                />
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{account.toolkitName}</span>
                <Pill tone={STATUS_TONE[account.status]} dot>{account.status.charAt(0) + account.status.slice(1).toLowerCase()}</Pill>
                {account.pendingAccountId && <Pill tone="amber" dot>{t("Reconnect waiting for authorization")}</Pill>}
                <span className="row" style={{ gap: 6, marginLeft: "auto" }}>
                  <Button size="small" disabled={busy} onClick={() => onReconnect(account.toolkitSlug)}>
                    {busySlug === account.toolkitSlug && busyAction === "connect" ? t("Opening…") : t("Reconnect")}
                  </Button>
                  <IconButton
                    icon="x"
                    label={t("Delete {name} connection", { name: account.toolkitName })}
                    disabled={busy}
                    onClick={() => onDelete(account.toolkitSlug)}
                  />
                </span>
              </div>
              {holders.length > 0 && (
                <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                  {holders.map((name) => <Pill key={name}>{name}</Pill>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
