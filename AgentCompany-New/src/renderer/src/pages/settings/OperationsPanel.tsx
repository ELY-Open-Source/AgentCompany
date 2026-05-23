import { Button, Pill } from "../../shared/ui";
import type {
  ChaosDrillRecord,
  ChaosDrillRunRecord,
  FeatureFlagRecord,
  OperationalEventRecord,
  SloTargetRecord,
} from "../../../../shared/domain";
import type { SnapshotActions } from "../../app/useSnapshot";
import { formatRelative } from "../types";

export function OperationsPanel({
  orgId,
  featureFlags,
  sloTargets,
  operationalEvents,
  chaosDrills,
  chaosDrillRuns,
  actions,
}: {
  orgId: string;
  featureFlags: FeatureFlagRecord[];
  sloTargets: SloTargetRecord[];
  operationalEvents: OperationalEventRecord[];
  chaosDrills: ChaosDrillRecord[];
  chaosDrillRuns: ChaosDrillRunRecord[];
  actions: SnapshotActions;
}) {
  return (
    <div className="page">
      <h1 className="page-h1">Operations</h1>
      <p className="page-sub">{featureFlags.length} flags / {sloTargets.length} SLOs / {chaosDrills.length} drills.</p>
      <FeatureFlagsTable orgId={orgId} flags={featureFlags} actions={actions} />
      <SloTable targets={sloTargets} events={operationalEvents} />
      <ChaosDrillsTable orgId={orgId} drills={chaosDrills} runs={chaosDrillRuns} actions={actions} />
    </div>
  );
}

function FeatureFlagsTable({
  orgId,
  flags,
  actions,
}: {
  orgId: string;
  flags: FeatureFlagRecord[];
  actions: SnapshotActions;
}) {
  return (
    <>
      <div className="section-label" style={{ marginBottom: 10 }}>Feature flags</div>
      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
        <div className="table-row head" style={{ gridTemplateColumns: "minmax(0, 1.4fr) 112px minmax(0, 1fr)" }}>
          <div>Flag</div><div>State</div><div>Updated</div>
        </div>
        {flags.map((flag, index) => (
          <div
            key={flag.id}
            className="table-row"
            style={{
              gridTemplateColumns: "minmax(0, 1.4fr) 112px minmax(0, 1fr)",
              borderBottom: index === flags.length - 1 ? "none" : "1px solid var(--border-soft)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{flag.label}</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{flag.key}</div>
            </div>
            <label className="row" style={{ gap: 8, fontSize: 12, color: "var(--text-2)" }}>
              <input
                aria-label={`${flag.label} enabled`}
                type="checkbox"
                checked={flag.enabled}
                onChange={(event) => {
                  void actions.run(() => window.agentCompany.setFeatureFlag({ orgId, flagId: flag.id, enabled: event.target.checked }));
                }}
              />
              {flag.enabled ? "On" : "Off"}
            </label>
            <div className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{formatRelative(flag.updatedAt)}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function SloTable({
  targets,
  events,
}: {
  targets: SloTargetRecord[];
  events: OperationalEventRecord[];
}) {
  return (
    <>
      <div className="section-label" style={{ marginBottom: 10 }}>SLO targets</div>
      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
        <div className="table-row head" style={{ gridTemplateColumns: "minmax(0, 1.4fr) 96px 112px 96px" }}>
          <div>Signal</div><div>Target</div><div>Current</div><div>Samples</div>
        </div>
        {targets.map((target, index) => {
          const samples = events.filter((event) => event.signalKey === target.signalKey && withinWindow(event.createdAt, target.windowMinutes));
          const successes = samples.filter((event) => event.success).length;
          return (
            <div
              key={target.id}
              className="table-row"
              style={{
                gridTemplateColumns: "minmax(0, 1.4fr) 96px 112px 96px",
                borderBottom: index === targets.length - 1 ? "none" : "1px solid var(--border-soft)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{target.label}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{target.signalKey}</div>
              </div>
              <div className="num mono">{formatBasisPoints(target.targetBasisPoints)}</div>
              <div><Pill tone={samples.length > 0 && currentBasisPoints(successes, samples.length) < target.targetBasisPoints ? "amber" : undefined}>{formatCurrent(successes, samples.length)}</Pill></div>
              <div className="num mono">{samples.length}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function ChaosDrillsTable({
  orgId,
  drills,
  runs,
  actions,
}: {
  orgId: string;
  drills: ChaosDrillRecord[];
  runs: ChaosDrillRunRecord[];
  actions: SnapshotActions;
}) {
  return (
    <>
      <div className="section-label" style={{ marginBottom: 10 }}>Chaos drills</div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-row head" style={{ gridTemplateColumns: "minmax(0, 1.4fr) 116px 96px 82px" }}>
          <div>Drill</div><div>Last run</div><div>Result</div><div>Action</div>
        </div>
        {drills.map((drill, index) => {
          const run = runs.find((item) => item.drillId === drill.id) ?? null;
          return (
            <div
              key={drill.id}
              className="table-row"
              style={{
                gridTemplateColumns: "minmax(0, 1.4fr) 116px 96px 82px",
                borderBottom: index === drills.length - 1 ? "none" : "1px solid var(--border-soft)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{drill.label}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{drill.scenarioKey}</div>
              </div>
              <div className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{run ? formatRelative(run.startedAt) : "0 runs"}</div>
              <div><Pill tone={run?.state === "failed" ? "red" : run?.state === "passed" ? "green" : undefined}>{run?.state ?? "Ready"}</Pill></div>
              <Button
                size="small"
                disabled={!drill.enabled}
                onClick={() => void actions.run(() => window.agentCompany.runChaosDrill({ orgId, drillId: drill.id }))}
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

function withinWindow(iso: string, windowMinutes: number): boolean {
  const createdAt = new Date(iso).getTime();
  if (Number.isNaN(createdAt)) return false;
  return Date.now() - createdAt <= windowMinutes * 60_000;
}

function currentBasisPoints(successes: number, samples: number): number {
  if (samples === 0) return 0;
  return Math.round((successes / samples) * 10000);
}

function formatCurrent(successes: number, samples: number): string {
  if (samples === 0) return "0 / 0";
  return formatBasisPoints(currentBasisPoints(successes, samples));
}

function formatBasisPoints(value: number): string {
  return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}%`;
}
