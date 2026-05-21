import type { FormEvent } from "react";
import { Button, Field } from "../shared/ui";
import type { SnapshotActions } from "./useSnapshot";

function value(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function Onboarding({ actions }: { actions: SnapshotActions }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createOrganization({
      organizationName: value(form, "organizationName"),
      mission: value(form, "mission"),
      goal: value(form, "goal"),
      employeeName: value(form, "employeeName"),
    }));
  };

  return (
    <main className="app-shell" style={{ display: "grid", placeItems: "center", padding: 24 }}>
      <form className="card" style={{ width: "min(560px, 100%)", display: "grid", gap: 14 }} onSubmit={submit}>
        <div>
          <h1 className="page-h1">AgentCompany</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>Create the company control plane.</p>
        </div>
        <Field label="Company name">
          <input className="input" name="organizationName" required autoFocus />
        </Field>
        <Field label="Your name">
          <input className="input" name="employeeName" required />
        </Field>
        <Field label="Mission">
          <textarea className="input" name="mission" required />
        </Field>
        <Field label="First goal">
          <textarea className="input" name="goal" required />
        </Field>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button tone="primary" type="submit">Create</Button>
        </div>
      </form>
    </main>
  );
}
