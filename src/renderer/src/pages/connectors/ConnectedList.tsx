import { useState, type FormEvent } from "react";
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
  onConnect,
  onDelete,
  onGrant,
  onRevoke,
}: {
  accounts: ConnectorAccountRecord[];
  grants: ConnectorGrantRecord[];
  agents: AgentRecord[];
  logoBySlug: Map<string, string | null>;
  busySlug: string | null;
  busyAction: "connect" | "disconnect" | null;
  onConnect: (toolkitSlug: string, label: string) => void;
  onDelete: (toolkitSlug: string, label: string) => void;
  onGrant: (agentId: string, toolkitSlug: string, label: string) => void;
  onRevoke: (agentId: string, toolkitSlug: string) => void;
}) {
  const [addSlug, setAddSlug] = useState("");
  const [addLabel, setAddLabel] = useState("");
  if (accounts.length === 0) return null;
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
  const toolkits = [...new Map(accounts.map((account) => [account.toolkitSlug, { slug: account.toolkitSlug, name: account.toolkitName }])).values()];
  const addAccount = (event: FormEvent) => {
    event.preventDefault();
    onConnect(addSlug, addLabel);
    setAddLabel("");
  };
  return (
    <section style={{ marginBottom: 24 }}>
      <div className="section-label" style={{ marginBottom: 12 }}>{t("Connected")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {accounts.map((account) => {
          const holders = grants
            .filter((grant) => grant.toolkitSlug === account.toolkitSlug && grant.accountLabel === account.label)
            .flatMap((grant) => {
              const name = agentNames.get(grant.agentId);
              return name ? [{ agentId: grant.agentId, text: grant.allowedActions || grant.fixedArguments ? `${name} · ${t("limited")}` : name }] : [];
            });
          // One account per toolkit per agent: only agents holding none of this toolkit can be granted here; the CEO holds all by role.
          const grantable = agents.filter((agent) => agent.roleLevel !== "c_suite" && !grants.some((grant) => grant.agentId === agent.id && grant.toolkitSlug === account.toolkitSlug));
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
                <span style={{ color: "var(--text-2)", fontSize: 12.5 }}>{account.label}</span>
                <Pill tone={STATUS_TONE[account.status]} dot>{account.status.charAt(0) + account.status.slice(1).toLowerCase()}</Pill>
                {account.pendingAccountId && <Pill tone="amber" dot>{t("Reconnect waiting for authorization")}</Pill>}
                <span className="row" style={{ gap: 6, marginLeft: "auto" }}>
                  <Button size="small" disabled={busy} onClick={() => onConnect(account.toolkitSlug, account.label)}>
                    {busySlug === account.toolkitSlug && busyAction === "connect" ? t("Opening…") : t("Reconnect")}
                  </Button>
                  <IconButton
                    icon="x"
                    label={t("Delete {name} connection", { name: `${account.toolkitName} ${account.label}` })}
                    disabled={busy}
                    onClick={() => onDelete(account.toolkitSlug, account.label)}
                  />
                </span>
              </div>
              <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                {holders.map((holder) => (
                  <span key={holder.agentId} className="row" style={{ gap: 2 }}>
                    <Pill>{holder.text}</Pill>
                    <IconButton icon="x" label={t("Revoke {name}", { name: holder.text })} disabled={busy} onClick={() => onRevoke(holder.agentId, account.toolkitSlug)} />
                  </span>
                ))}
                {account.status === "ACTIVE" && grantable.length > 0 && (
                  <select
                    className="input"
                    style={{ width: 160 }}
                    value=""
                    disabled={busy}
                    aria-label={t("Grant {name} to", { name: `${account.toolkitName} ${account.label}` })}
                    onChange={(event) => onGrant(event.target.value, account.toolkitSlug, account.label)}
                  >
                    <option value="" disabled>{t("Grant to…")}</option>
                    {grantable.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                  </select>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <form className="row" style={{ gap: 8, marginTop: 12 }} onSubmit={addAccount}>
        <select className="input" style={{ width: 180 }} value={addSlug} onChange={(event) => setAddSlug(event.target.value)} required>
          <option value="" disabled>{t("Service")}</option>
          {toolkits.map((toolkit) => <option key={toolkit.slug} value={toolkit.slug}>{toolkit.name}</option>)}
        </select>
        <input className="input" style={{ width: 200 }} placeholder={t("Account label, e.g. sales")} value={addLabel} onChange={(event) => setAddLabel(event.target.value)} required maxLength={40} />
        <Button size="small" type="submit" disabled={busySlug !== null}>{t("Add account")}</Button>
      </form>
    </section>
  );
}
