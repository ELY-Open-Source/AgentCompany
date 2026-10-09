import { XpBar } from "../../shared/XpBar";
import { Avatar, Pill } from "../../shared/ui";
import type { AgentRecord, HiringPolicyRecord, ProviderRecord } from "../../../../shared/domain";
import { money } from "../types";
import { buildAgentSpend } from "./billing-helpers";
import type { ProviderRateLimitStateRecord } from "../../../../shared/provider-runtime-domain";
import type { UsageStatsRecord } from "../../../../shared/usage-stats";
import { t } from "../../i18n/i18n";

export function BillingPanel({
  agents,
  providers,
  usage,
  providerRateLimits,
  hiringPolicies,
}: {
  agents: AgentRecord[];
  providers: ProviderRecord[];
  /** Last 30 days over every call, computed in the main process. */
  usage: UsageStatsRecord;
  providerRateLimits: ProviderRateLimitStateRecord[];
  hiringPolicies: HiringPolicyRecord[];
}) {
  // Month to date, from the provider totals: every call counts, not only the ones loaded into the snapshot.
  const spentCents = providerRateLimits.reduce((s, usage) => s + usage.costCents, 0);
  const unpricedCalls = providerRateLimits.reduce((s, usage) => s + usage.unpricedRequests + usage.requestsWithoutUsage, 0);
  const totalBudget = agents.reduce((sum, a) => sum + a.budgetCents, 0);
  const totalCap = hiringPolicies.reduce((sum, p) => sum + p.monthlyBudgetLimitCents, 0);
  const { inputTokens, cachedInputTokens: cachedTokens, outputTokens, reasoningTokens, callsWithoutUsage: unreported } = usage.month;
  const agentSpend = buildAgentSpend(agents, usage.agentSpend);

  return (
    <div>
      <div className="section-label" style={{ marginBottom: 10 }}>{t("Billing")}</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 20 }}>
        <StatTile label={t("Monthly allocation")} value={money(totalBudget)} />
        <StatTile label={t("Budget cap")} value={totalCap > 0 ? money(totalCap) : "—"} />
        <StatTile label={t("Requests (30d)")} value={String(usage.month.requests)} />
        <StatTile label={t("Failures (30d)")} value={String(usage.month.failures)} tone={usage.month.failures > 0 ? "red" : undefined} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        <div className="card" style={{ padding: 14 }}>
          <div className="card-label" style={{ marginBottom: 8 }}>{t("Token usage (30d)")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "6px 14px", fontSize: 12 }}>
            <span style={{ color: "var(--text-3)" }}>{t("Input")}</span><span className="num">{inputTokens.toLocaleString()}</span>
            <span style={{ color: "var(--text-3)" }}>{t("of which cached")}</span><span className="num">{cachedTokens.toLocaleString()}</span>
            <span style={{ color: "var(--text-3)" }}>{t("Output")}</span><span className="num">{outputTokens.toLocaleString()}</span>
            <span style={{ color: "var(--text-3)" }}>{t("of which reasoning")}</span><span className="num">{reasoningTokens.toLocaleString()}</span>
            {unreported > 0 && <><span style={{ color: "var(--text-3)" }}>{t("Calls without usage")}</span><span className="num">{unreported}</span></>}
          </div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="card-label" style={{ marginBottom: 8 }}>{t("Spent this month")}</div>
          <div style={{ marginBottom: 8 }}><XpBar percent={totalBudget > 0 ? (spentCents / totalBudget) * 100 : 0} label={t("Spent this month")} /></div>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>
            {t("${spent} of ${allocated} allocated to agents", { spent: (spentCents / 100).toFixed(2), allocated: (totalBudget / 100).toFixed(2) })}
            {unpricedCalls > 0 && <> · {t("{count} calls not priced", { count: unpricedCalls })}</>}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
            {totalCap > 0 ? t("Allocations use {percent}% of department caps", { percent: Math.round((totalBudget / totalCap) * 100) }) : t("No budget cap set")}
          </div>
        </div>
      </div>

      <div className="section-label" style={{ marginBottom: 10 }}>{t("Cost by agent")}</div>
      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
        <div className="table-row head" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)" }}>
          <div>{t("Agent")}</div><div>{t("Budget")}</div><div>{t("Requests")}</div><div>{t("Tokens")}</div><div>{t("Spent")}</div>
        </div>
        {agentSpend.map((row, i) => (
          <div key={row.agent.id} className="table-row" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", borderBottom: i === agentSpend.length - 1 ? "none" : "1px solid var(--border-soft)" }}>
            <div className="row" style={{ gap: 8 }}>
              <Avatar name={row.agent.name} size="sm" bot />
              <span style={{ fontWeight: 480 }}>{row.agent.name}</span>
            </div>
            <div className="num mono">{money(row.agent.budgetCents)}</div>
            <div className="num mono">{row.requestCount}</div>
            <div className="num mono" style={{ fontSize: 12 }}>{row.tokens.toLocaleString()}</div>
            <div className="num mono" style={{ fontSize: 12 }}>${(row.spentCents / 100).toFixed(2)}</div>
          </div>
        ))}
      </div>

      <div className="section-label" style={{ marginBottom: 10 }}>{t("Provider activity (30d)")}</div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-row head" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)" }}>
          <div>{t("Provider")}</div><div>{t("Requests")}</div><div>{t("Errors")}</div><div>{t("Agents")}</div>
        </div>
        {providers.map((provider, index) => {
          const activity = usage.providerActivity.find((row) => row.providerId === provider.id);
          const errors = activity?.failures ?? 0;
          const boundAgents = agents.filter((a) => a.modelProviderId === provider.id).length;
          return (
            <div key={provider.id} className="table-row" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", borderBottom: index === providers.length - 1 ? "none" : "1px solid var(--border-soft)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 540 }}>{provider.label}</div>
                {provider.model && <div style={{ fontSize: 12, color: "var(--text-3)" }}>{provider.model}</div>}
              </div>
              <div className="num mono">{activity?.requests ?? 0}</div>
              <div>{errors > 0 ? <Pill tone="amber">{errors}</Pill> : <span className="num mono" style={{ color: "var(--text-3)" }}>0</span>}</div>
              <div className="num mono" style={{ color: "var(--text-2)" }}>{boundAgents}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: "red" }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="card-label" style={{ marginBottom: 6 }}>{label}</div>
      <div className="num" style={{ fontSize: 18, fontWeight: 600, color: tone === "red" ? "var(--red)" : "var(--text-1)" }}>{value}</div>
    </div>
  );
}
