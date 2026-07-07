import { Pill } from "../../shared/ui";
import type { AgentRecord, ConnectorAccountRecord, ConnectorGrantRecord } from "../../../../shared/domain";
import { ToolkitTile } from "./ToolkitCatalog";

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
 * or the board has granted access to. Toggling a chip grants or revokes.
 */
export function ConnectedList({
  accounts,
  grants,
  agents,
  logoBySlug,
  onGrant,
  onRevoke,
}: {
  accounts: ConnectorAccountRecord[];
  grants: ConnectorGrantRecord[];
  agents: AgentRecord[];
  logoBySlug: Map<string, string | null>;
  onGrant: (agentId: string, toolkitSlug: string) => void;
  onRevoke: (agentId: string, toolkitSlug: string) => void;
}) {
  if (accounts.length === 0) return null;
  return (
    <section style={{ marginBottom: 24 }}>
      <div className="section-label" style={{ marginBottom: 12 }}>Connected</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {accounts.map((account) => (
          <ConnectedRow
            key={account.id}
            account={account}
            grantedAgentIds={new Set(grants.filter((grant) => grant.toolkitSlug === account.toolkitSlug).map((grant) => grant.agentId))}
            agents={agents}
            logoUrl={logoBySlug.get(account.toolkitSlug) ?? null}
            onGrant={onGrant}
            onRevoke={onRevoke}
          />
        ))}
      </div>
    </section>
  );
}

function ConnectedRow({
  account,
  grantedAgentIds,
  agents,
  logoUrl,
  onGrant,
  onRevoke,
}: {
  account: ConnectorAccountRecord;
  grantedAgentIds: Set<string>;
  agents: AgentRecord[];
  logoUrl: string | null;
  onGrant: (agentId: string, toolkitSlug: string) => void;
  onRevoke: (agentId: string, toolkitSlug: string) => void;
}) {
  const active = account.status === "ACTIVE";
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, background: "var(--panel)" }}>
      <div className="row" style={{ gap: 10 }}>
        <ToolkitTile name={account.toolkitName} slug={account.toolkitSlug} logoUrl={logoUrl} size={30} />
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{account.toolkitName}</span>
        <Pill tone={STATUS_TONE[account.status]} dot>{account.status.charAt(0) + account.status.slice(1).toLowerCase()}</Pill>
      </div>
      {active && agents.length > 0 && (
        <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          {agents.map((agent) => {
            const granted = grantedAgentIds.has(agent.id);
            return (
              <button
                key={agent.id}
                type="button"
                aria-pressed={granted}
                aria-label={`${granted ? "Revoke" : "Grant"} ${account.toolkitName} for ${agent.name}`}
                onClick={() => (granted ? onRevoke(agent.id, account.toolkitSlug) : onGrant(agent.id, account.toolkitSlug))}
                style={{
                  border: granted ? "1px solid var(--accent)" : "1px solid var(--border-strong)",
                  background: granted ? "var(--accent-soft)" : "var(--panel)",
                  color: granted ? "var(--accent)" : "var(--text-2)",
                  borderRadius: 999,
                  padding: "4px 12px",
                  fontSize: 12.5,
                  fontWeight: 540,
                  cursor: "pointer",
                }}
              >
                {agent.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
