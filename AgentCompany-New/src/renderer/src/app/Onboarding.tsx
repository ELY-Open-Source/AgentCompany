import { useMemo, useState, type FormEvent } from "react";
import { PROVIDER_AUTH_TYPE } from "../../../shared/domain";
import { Button, Field, Icon, Pill } from "../shared/ui";
import type { SnapshotActions } from "./useSnapshot";
import type { AppSnapshot, ProviderCatalogEntry } from "../../../shared/domain";

type Step = "welcome" | "provider" | "company" | "mode" | "mission" | "launch";

interface Draft {
  companyName: string;
  companyDescription: string;
  employeeName: string;
  workspacePath: string;
  executionMode: "ai_ceo" | "ai_cofounder";
  providerKey: string;
  providerSecret: string;
  providerModel: string;
  goalTitle: string;
  goalDescription: string;
}

const steps: Array<{ id: Step; label: string }> = [
  { id: "welcome", label: "Start" },
  { id: "provider", label: "Provider" },
  { id: "company", label: "Company" },
  { id: "mode", label: "Mode" },
  { id: "mission", label: "Goal" },
  { id: "launch", label: "Launch" },
];

const initialDraft: Draft = {
  companyName: "",
  companyDescription: "",
  employeeName: "",
  workspacePath: "",
  executionMode: "ai_ceo",
  providerKey: "",
  providerSecret: "",
  providerModel: "",
  goalTitle: "",
  goalDescription: "",
};

export function Onboarding({ snapshot, actions }: { snapshot: AppSnapshot; actions: SnapshotActions }) {
  const apiProviders = useMemo(
    () => snapshot.providerCatalog.filter((entry) => entry.authType === PROVIDER_AUTH_TYPE.API_KEY),
    [snapshot.providerCatalog],
  );
  const [step, setStep] = useState<Step>("welcome");
  const [draft, setDraft] = useState<Draft>(() => {
    const firstProvider = apiProviders[0];
    if (!firstProvider?.defaultModel) throw new Error("Provider catalog requires a default API model.");
    return { ...initialDraft, providerKey: firstProvider.key, providerModel: firstProvider.defaultModel };
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectedProvider = requireProvider(apiProviders, draft.providerKey);

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const go = (next: Step) => {
    setError(null);
    setStep(next);
  };

  const launch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateDraft(draft);
    if (validation) {
      setError(validation);
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await window.agentCompany.bootstrapOnboarding({
      companyName: draft.companyName.trim(),
      companyDescription: draft.companyDescription.trim(),
      employeeName: draft.employeeName.trim(),
      workspacePath: draft.workspacePath.trim(),
      executionMode: draft.executionMode,
      autoApproveHires: draft.executionMode === "ai_ceo",
      reviewDeliverables: draft.executionMode === "ai_cofounder",
      goalTitle: draft.goalTitle.trim(),
      goalDescription: draft.goalDescription.trim(),
      providerKey: draft.providerKey,
      providerSecret: draft.providerSecret.trim(),
      providerModel: draft.providerModel.trim(),
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await actions.reload();
  };

  return (
    <main className="onboarding-shell">
      <section className="onboarding-hero">
        <div>
          <div className="brand" style={{ padding: 0 }}>
            <div className="brand-mark">A</div>
            <div className="brand-name">AgentCompany</div>
          </div>
          <h1 className="page-h1" style={{ fontSize: 34, marginTop: 34 }}>Start your AI company.</h1>
          <p className="page-sub" style={{ maxWidth: 420 }}>
            Create the company, bind the CEO runtime, and queue the first operating loop.
          </p>
          <div className="onboarding-steps">
            {steps.map((item) => (
              <span key={item.id} className={`step-chip ${item.id === step ? "active" : ""}`}>{item.label}</span>
            ))}
          </div>
        </div>
        <div className="card" style={{ maxWidth: 440 }}>
          <div className="card-label">Selected runtime</div>
          <div className="row" style={{ marginTop: 12 }}>
            <Icon name="bot" />
            <strong>{selectedProvider.label}</strong>
            <Pill tone="violet">{draft.providerModel}</Pill>
          </div>
        </div>
      </section>

      <form className="onboarding-panel" onSubmit={launch}>
        {step === "welcome" && <WelcomeStep onNext={() => go("provider")} />}
        {step === "provider" && (
          <ProviderStep
            providers={apiProviders}
            draft={draft}
            onChange={update}
            onBack={() => go("welcome")}
            onNext={() => validateProvider(draft) ? setError(validateProvider(draft)) : go("company")}
          />
        )}
        {step === "company" && (
          <CompanyStep
            draft={draft}
            onChange={update}
            onBack={() => go("provider")}
            onNext={() => validateCompany(draft) ? setError(validateCompany(draft)) : go("mode")}
          />
        )}
        {step === "mode" && (
          <ModeStep draft={draft} onChange={update} onBack={() => go("company")} onNext={() => go("mission")} />
        )}
        {step === "mission" && (
          <MissionStep
            draft={draft}
            submitting={submitting}
            onChange={update}
            onBack={() => go("mode")}
          />
        )}
        {step === "launch" && null}
        {error && <div style={{ color: "var(--red)", marginTop: 12 }}>{error}</div>}
      </form>
    </main>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="form-grid">
      <h2 className="page-h1">Welcome</h2>
      <Button tone="primary" onClick={onNext}>Get started</Button>
    </div>
  );
}

function ProviderStep({
  providers,
  draft,
  onChange,
  onBack,
  onNext,
}: {
  providers: ProviderCatalogEntry[];
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="form-grid">
      <h2 className="page-h1">Provider</h2>
      <div className="option-grid">
        {providers.map((provider) => (
          <button
            key={provider.key}
            type="button"
            className={`option-card ${draft.providerKey === provider.key ? "active" : ""}`}
            onClick={() => onChange({ providerKey: provider.key, providerModel: provider.defaultModel ?? "" })}
          >
            <div className="row">
              <strong>{provider.label}</strong>
              <Pill>{provider.authType}</Pill>
            </div>
          </button>
        ))}
      </div>
      <Field label="API key">
        <input className="input" type="password" value={draft.providerSecret} onChange={(event) => onChange({ providerSecret: event.target.value })} />
      </Field>
      <Field label="Model">
        <input className="input" value={draft.providerModel} onChange={(event) => onChange({ providerModel: event.target.value })} />
      </Field>
      <FormActions onBack={onBack} onNext={onNext} />
    </div>
  );
}

function CompanyStep({ draft, onChange, onBack, onNext }: StepProps) {
  return (
    <div className="form-grid">
      <h2 className="page-h1">Company</h2>
      <Field label="Company name">
        <input className="input" value={draft.companyName} onChange={(event) => onChange({ companyName: event.target.value })} autoFocus />
      </Field>
      <Field label="Your name">
        <input className="input" value={draft.employeeName} onChange={(event) => onChange({ employeeName: event.target.value })} />
      </Field>
      <Field label="Description">
        <textarea className="input" value={draft.companyDescription} onChange={(event) => onChange({ companyDescription: event.target.value })} />
      </Field>
      <Field label="Workspace path">
        <input className="input" value={draft.workspacePath} onChange={(event) => onChange({ workspacePath: event.target.value })} />
      </Field>
      <FormActions onBack={onBack} onNext={onNext} />
    </div>
  );
}

function ModeStep({ draft, onChange, onBack, onNext }: StepProps) {
  return (
    <div className="form-grid">
      <h2 className="page-h1">Mode</h2>
      {(["ai_ceo", "ai_cofounder"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className={`option-card ${draft.executionMode === mode ? "active" : ""}`}
          onClick={() => onChange({ executionMode: mode })}
        >
          <strong>{mode === "ai_ceo" ? "AI CEO" : "AI Co-Founder"}</strong>
        </button>
      ))}
      <FormActions onBack={onBack} onNext={onNext} />
    </div>
  );
}

function MissionStep({ draft, submitting, onChange, onBack }: Omit<StepProps, "onNext"> & { submitting: boolean }) {
  return (
    <div className="form-grid">
      <h2 className="page-h1">Goal</h2>
      <Field label="Goal">
        <input className="input" value={draft.goalTitle} onChange={(event) => onChange({ goalTitle: event.target.value })} />
      </Field>
      <Field label="Acceptance criteria">
        <textarea className="input" value={draft.goalDescription} onChange={(event) => onChange({ goalDescription: event.target.value })} />
      </Field>
      <div className="modal-actions" style={{ marginTop: 4 }}>
        <Button onClick={onBack}>Back</Button>
        <Button tone="primary" type="submit" disabled={submitting}>Launch</Button>
      </div>
    </div>
  );
}

function FormActions({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="modal-actions" style={{ marginTop: 4 }}>
      <Button onClick={onBack}>Back</Button>
      <Button tone="primary" onClick={onNext}>Continue</Button>
    </div>
  );
}

interface StepProps {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  onBack: () => void;
  onNext: () => void;
}

function requireProvider(providers: ProviderCatalogEntry[], key: string): ProviderCatalogEntry {
  const provider = providers.find((entry) => entry.key === key);
  if (!provider) throw new Error("Provider selection is invalid.");
  return provider;
}

function validateProvider(draft: Draft): string | null {
  if (!draft.providerKey) return "Select a provider.";
  if (!draft.providerSecret.trim()) return "API key is required.";
  if (!draft.providerModel.trim()) return "Model is required.";
  return null;
}

function validateCompany(draft: Draft): string | null {
  if (!draft.companyName.trim()) return "Company name is required.";
  if (!draft.employeeName.trim()) return "Your name is required.";
  return null;
}

function validateDraft(draft: Draft): string | null {
  return validateProvider(draft) ?? validateCompany(draft) ?? (!draft.goalTitle.trim() ? "Goal is required." : null);
}
