import { Button, Pill } from "../../shared/ui";
import type {
  EvalCaseRecord,
  EvalRunRecord,
  EvalSuiteRecord,
  MigrationReportRecord,
  PolicyRuleRecord,
  PrBotGateRecord,
  SdlcReviewAgentRecord,
  SdlcReviewRunRecord,
  SdlcReviewTargetType,
} from "../../../../shared/domain";
import { SDLC_REVIEW_AGENT_KEY, SDLC_REVIEW_TARGET_TYPE } from "../../../../shared/domain";
import type { SnapshotActions } from "../../app/useSnapshot";
import { formatRelative } from "../types";

export function SdlcPanel({
  orgId,
  reviewAgents,
  reviewRuns,
  evalSuites,
  evalCases,
  evalRuns,
  prBotGates,
  migrationReports,
  policies,
  actions,
}: {
  orgId: string;
  reviewAgents: SdlcReviewAgentRecord[];
  reviewRuns: SdlcReviewRunRecord[];
  evalSuites: EvalSuiteRecord[];
  evalCases: EvalCaseRecord[];
  evalRuns: EvalRunRecord[];
  prBotGates: PrBotGateRecord[];
  migrationReports: MigrationReportRecord[];
  policies: PolicyRuleRecord[];
  actions: SnapshotActions;
}) {
  return (
    <div className="page">
      <h1 className="page-h1">SDLC</h1>
      <p className="page-sub">{reviewAgents.length} agents / {evalSuites.length} suites / {prBotGates.length} gates.</p>
      <ReviewAgentsTable
        orgId={orgId}
        agents={reviewAgents}
        runs={reviewRuns}
        migrationReports={migrationReports}
        policies={policies}
        actions={actions}
      />
      <EvalSuitesTable orgId={orgId} suites={evalSuites} cases={evalCases} runs={evalRuns} actions={actions} />
      <PrBotGatesTable orgId={orgId} gates={prBotGates} actions={actions} />
    </div>
  );
}

function ReviewAgentsTable({
  orgId,
  agents,
  runs,
  migrationReports,
  policies,
  actions,
}: {
  orgId: string;
  agents: SdlcReviewAgentRecord[];
  runs: SdlcReviewRunRecord[];
  migrationReports: MigrationReportRecord[];
  policies: PolicyRuleRecord[];
  actions: SnapshotActions;
}) {
  return (
    <>
      <div className="section-label" style={{ marginBottom: 10 }}>Review agents</div>
      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
        <div className="table-row head" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) 96px 82px" }}>
          <div>Agent</div><div>Target</div><div>Last run</div><div>Action</div>
        </div>
        {agents.map((agent, index) => {
          const target = resolveReviewTarget(agent, orgId, migrationReports, policies);
          const run = runs.find((item) => item.reviewAgentId === agent.id) ?? null;
          return (
            <div
              key={agent.id}
              className="table-row"
              style={{
                gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) 96px 82px",
                borderBottom: index === agents.length - 1 ? "none" : "1px solid var(--border-soft)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.label}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{agent.specialty}</div>
              </div>
              <div><Pill>{target.label}</Pill></div>
              <div className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{run ? `${run.state} · ${formatRelative(run.createdAt)}` : "0 runs"}</div>
              <Button
                size="small"
                disabled={!agent.enabled || !target.ready}
                onClick={() => void actions.run(() => window.agentCompany.runSdlcReview({
                  orgId,
                  reviewAgentId: agent.id,
                  targetType: target.type,
                  targetRef: target.ref,
                }))}
              >
                Run
              </Button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function EvalSuitesTable({
  orgId,
  suites,
  cases,
  runs,
  actions,
}: {
  orgId: string;
  suites: EvalSuiteRecord[];
  cases: EvalCaseRecord[];
  runs: EvalRunRecord[];
  actions: SnapshotActions;
}) {
  return (
    <>
      <div className="section-label" style={{ marginBottom: 10 }}>Eval suites</div>
      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
        <div className="table-row head" style={{ gridTemplateColumns: "minmax(0, 1.4fr) 90px 96px 82px" }}>
          <div>Suite</div><div>Cases</div><div>Last run</div><div>Action</div>
        </div>
        {suites.map((suite, index) => {
          const run = runs.find((item) => item.suiteId === suite.id) ?? null;
          const caseCount = cases.filter((item) => item.suiteId === suite.id).length;
          return (
            <div
              key={suite.id}
              className="table-row"
              style={{
                gridTemplateColumns: "minmax(0, 1.4fr) 90px 96px 82px",
                borderBottom: index === suites.length - 1 ? "none" : "1px solid var(--border-soft)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{suite.label}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{suite.scope}</div>
              </div>
              <div className="num mono">{caseCount}</div>
              <div className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{run ? `${run.state} · ${formatRelative(run.createdAt)}` : "0 runs"}</div>
              <Button size="small" onClick={() => void actions.run(() => window.agentCompany.runEvalSuite({ orgId, suiteId: suite.id }))}>
                Run
              </Button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function PrBotGatesTable({
  orgId,
  gates,
  actions,
}: {
  orgId: string;
  gates: PrBotGateRecord[];
  actions: SnapshotActions;
}) {
  return (
    <>
      <div className="section-label" style={{ marginBottom: 10 }}>PR bot gates</div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-row head" style={{ gridTemplateColumns: "minmax(0, 1.4fr) 112px minmax(0, 1fr)" }}>
          <div>Gate</div><div>State</div><div>Updated</div>
        </div>
        {gates.map((gate, index) => (
          <div
            key={gate.id}
            className="table-row"
            style={{
              gridTemplateColumns: "minmax(0, 1.4fr) 112px minmax(0, 1fr)",
              borderBottom: index === gates.length - 1 ? "none" : "1px solid var(--border-soft)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{gate.label}</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{gate.gateType}</div>
            </div>
            <label className="row" style={{ gap: 8, fontSize: 12, color: "var(--text-2)" }}>
              <input
                aria-label={`${gate.label} enabled`}
                type="checkbox"
                checked={gate.enabled}
                onChange={(event) => {
                  void actions.run(() => window.agentCompany.setPrBotGate({ orgId, gateId: gate.id, enabled: event.target.checked }));
                }}
              />
              {gate.enabled ? "On" : "Off"}
            </label>
            <div className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{formatRelative(gate.updatedAt)}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function resolveReviewTarget(
  agent: SdlcReviewAgentRecord,
  orgId: string,
  migrationReports: MigrationReportRecord[],
  policies: PolicyRuleRecord[],
): { type: SdlcReviewTargetType; ref: string; label: string; ready: boolean } {
  if (agent.key === SDLC_REVIEW_AGENT_KEY.MIGRATION_REVIEWER) {
    const report = migrationReports[0] ?? null;
    return {
      type: SDLC_REVIEW_TARGET_TYPE.MIGRATION,
      ref: report?.id ?? orgId,
      label: report ? "migration" : "migration report",
      ready: Boolean(report),
    };
  }
  if (agent.key === SDLC_REVIEW_AGENT_KEY.POLICY_REVIEWER) {
    const policy = policies[0] ?? null;
    return {
      type: SDLC_REVIEW_TARGET_TYPE.POLICY,
      ref: policy?.id ?? orgId,
      label: policy ? "policy" : "policy rule",
      ready: Boolean(policy),
    };
  }
  return { type: SDLC_REVIEW_TARGET_TYPE.WORKSPACE, ref: orgId, label: "workspace", ready: true };
}
