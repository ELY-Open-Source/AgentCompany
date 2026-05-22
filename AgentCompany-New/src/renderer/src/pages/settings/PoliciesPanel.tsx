import { Pill } from "../../shared/ui";
import type { PolicyRuleRecord } from "../../../../shared/domain";

export function PoliciesPanel({ policies }: { policies: PolicyRuleRecord[] }) {
  return (
    <div className="page">
      <h1 className="page-h1">Policies</h1>
      <p className="page-sub">Policy rules evaluated for actions across the workspace.</p>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          className="table-row head"
          style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr)" }}
        >
          <div>Action</div><div>Effect</div><div>Risk ceiling</div><div>Subject</div>
        </div>
        {policies.map((policy, index) => (
          <div
            key={policy.id}
            className="table-row"
            style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr)", borderBottom: index === policies.length - 1 ? "none" : "1px solid var(--border-soft)" }}
          >
            <div style={{ fontWeight: 540 }}>{policy.action.replaceAll("_", " ")}</div>
            <div><Pill>{policy.effect.replaceAll("_", " ")}</Pill></div>
            <div>
              <Pill tone={policy.riskCeiling === "high" ? "red" : policy.riskCeiling === "medium" ? "amber" : undefined}>
                {policy.riskCeiling}
              </Pill>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>{policy.subjectType}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
