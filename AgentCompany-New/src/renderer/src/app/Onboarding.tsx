import { useMemo, useState, type FormEvent } from "react";
import {
  PROVIDER_AUTH_TYPE,
  type AppSnapshot,
  type ProviderCatalogEntry,
} from "../../../shared/domain";
import { Button, Field, Icon, Pill } from "../shared/ui";
import type { SnapshotActions } from "./useSnapshot";

type Step = "welcome" | "provider" | "company" | "mode" | "mission";

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

const STEPS: Array<{ id: Step; label: string }> = [
  { id: "welcome", label: "Start" },
  { id: "provider", label: "Provider" },
  { id: "company", label: "Company" },
  { id: "mode", label: "Mode" },
  { id: "mission", label: "Goal" },
];

export function Onboarding({
  snapshot,
  actions,
  onCancel,
  onCompleted,
}: {
  snapshot: AppSnapshot;
  actions: SnapshotActions;
  onCancel: (() => void) | null;
  onCompleted: () => void;
}) {
  const availableProviders = useMemo(
    () => snapshot.providerCatalog.filter((entry) => entry.authType !== PROVIDER_AUTH_TYPE.CLOUD),
    [snapshot.providerCatalog],
  );
  const firstProvider = availableProviders[0];
  if (!firstProvider) throw new Error("Provider catalog must include at least one non-cloud provider.");

  const [step, setStep] = useState<Step>("welcome");
  const [draft, setDraft] = useState<Draft>({
    companyName: "",
    companyDescription: "",
    employeeName: "",
    workspacePath: "",
    executionMode: "ai_ceo",
    providerKey: firstProvider.key,
    providerSecret: "",
    providerModel: firstProvider.defaultModel ?? firstProvider.models[0]?.id ?? "",
    goalTitle: "",
    goalDescription: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedProvider = requireProvider(availableProviders, draft.providerKey);
  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const guard = (validator: () => string | null, next: Step) => () => {
    const message = validator();
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    setStep(next);
  };

  const back = (target: Step) => () => {
    setError(null);
    setStep(target);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = validateAll(draft, availableProviders);
    if (message) {
      setError(message);
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
    onCompleted();
  };

  return (
    <main className="onboarding-shell">
      <section className="onboarding-hero">
        <div>
          <div className="row" style={{ gap: 8 }}>
            <div className="brand-mark">A</div>
            <div style={{ fontWeight: 540 }}>AgentCompany</div>
            {onCancel && (
              <button type="button" className="button ghost" style={{ marginLeft: "auto" }} onClick={onCancel}>
                Cancel
              </button>
            )}
          </div>
          <h1 className="page-h1" style={{ fontSize: 34, marginTop: 32, letterSpacing: "-0.02em" }}>Start your AI company.</h1>
          <p className="page-sub" style={{ maxWidth: 460, fontSize: 14, lineHeight: 1.55 }}>
            Stand up the workspace, bind the provider, and queue the first operating loop.
          </p>
          <div className="onboarding-steps">
            {STEPS.map((entry) => (
              <span key={entry.id} className={`step-chip ${entry.id === step ? "active" : ""}`}>{entry.label}</span>
            ))}
          </div>
        </div>
        <div className="card" style={{ maxWidth: 460 }}>
          <div className="card-label" style={{ marginBottom: 10 }}>Runtime selected</div>
          <div className="row" style={{ gap: 10 }}>
            <Icon name="bot" size={16} />
            <strong style={{ fontSize: 13 }}>{selectedProvider.label}</strong>
            <Pill tone="violet">{draft.providerModel}</Pill>
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-3)" }}>
            We never embed the key in the build. Credentials encrypt locally via OS-protected storage.
          </div>
        </div>
      </section>

      <form className="onboarding-panel" onSubmit={submit} noValidate>
        {step === "welcome" && (
          <WelcomeStep onNext={() => setStep("provider")} />
        )}
        {step === "provider" && (
          <ProviderStep
            providers={availableProviders}
            draft={draft}
            onChange={update}
            onBack={back("welcome")}
            onNext={guard(() => validateProvider(draft, availableProviders), "company")}
          />
        )}
        {step === "company" && (
          <CompanyStep
            draft={draft}
            onChange={update}
            onBack={back("provider")}
            onNext={guard(() => validateCompany(draft), "mode")}
          />
        )}
        {step === "mode" && (
          <ModeStep draft={draft} onChange={update} onBack={back("company")} onNext={() => setStep("mission")} />
        )}
        {step === "mission" && (
          <MissionStep
            draft={draft}
            submitting={submitting}
            onChange={update}
            onBack={back("mode")}
          />
        )}
        {error && <div style={{ color: "var(--red)", marginTop: 14, fontSize: 12.5 }}>{error}</div>}
      </form>
    </main>
  );
}

interface StepProps {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  onBack: () => void;
  onNext: () => void;
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="form-grid">
      <h2 className="page-h1">Welcome</h2>
      <p style={{ color: "var(--text-2)", fontSize: 14, lineHeight: 1.55 }}>
        AgentCompany sets up your operating loop in five steps. Bring an API key, pick a runtime
        for the founding CEO, and we'll wire up the first goal, project, and task.
      </p>
      <ul style={{ paddingLeft: 18, color: "var(--text-2)", lineHeight: 1.8, margin: 0 }}>
        <li>Connect one model provider (OpenAI, Anthropic, xAI, or Groq).</li>
        <li>Name the company and the human board chair.</li>
        <li>Pick execution mode and bind the workspace path.</li>
        <li>State the first goal — we kick off the rest.</li>
      </ul>
      <div className="modal-actions" style={{ marginTop: 4 }}>
        <Button tone="primary" onClick={onNext}>Get started</Button>
      </div>
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
  const selected = providers.find((entry) => entry.key === draft.providerKey) ?? providers[0];
  if (!selected) throw new Error("No provider available for onboarding.");
  const isOAuthLike = selected.authType === "oauth_pkce" || selected.authType === "account_subscription";
  const secretLabel = isOAuthLike ? "Access token" : "API key";

  return (
    <div className="form-grid">
      <h2 className="page-h1">Provider</h2>
      <p style={{ color: "var(--text-3)", fontSize: 13 }}>
        Pick the runtime for the founding CEO. You can attach more providers in Settings later.
      </p>
      <div className="option-grid">
        {providers.map((provider) => (
          <button
            key={provider.key}
            type="button"
            className={`option-card ${draft.providerKey === provider.key ? "active" : ""}`.trim()}
            onClick={() => onChange({
              providerKey: provider.key,
              providerModel: provider.defaultModel ?? provider.models[0]?.id ?? "",
              providerSecret: "",
            })}
          >
            <div className="row">
              <div className="opt-title" style={{ flex: 1 }}>{provider.label}</div>
              <Pill tone="violet">{authBadge(provider.authType)}</Pill>
            </div>
            <div className="opt-sub">{provider.capabilityTags.join(" · ") || authBadge(provider.authType)}</div>
          </button>
        ))}
      </div>
      {selected.credentialHelp && (
        <div style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.5 }}>{selected.credentialHelp}</div>
      )}
      {isOAuthLike && selected.signInUrl && (
        <div className="row" style={{ gap: 8 }}>
          <Button
            tone="primary"
            onClick={() => void window.agentCompany.openExternalUrl(selected.signInUrl ?? "")}
          >
            Open {selected.label} sign-in
          </Button>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{selected.signInUrl}</span>
        </div>
      )}
      <Field label={secretLabel}>
        <input
          className="input"
          type="password"
          autoComplete="off"
          value={draft.providerSecret}
          onChange={(event) => onChange({ providerSecret: event.target.value })}
        />
      </Field>
      <Field label="Model">
        {selected.models.length ? (
          <select
            className="input"
            value={draft.providerModel}
            onChange={(event) => onChange({ providerModel: event.target.value })}
          >
            {selected.models.map((model) => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </select>
        ) : (
          <input className="input" value={draft.providerModel} onChange={(event) => onChange({ providerModel: event.target.value })} />
        )}
      </Field>
      <Actions onBack={onBack} onNext={onNext} />
    </div>
  );
}

function authBadge(authType: string): string {
  if (authType === "api_key") return "API key";
  if (authType === "oauth_pkce") return "OAuth";
  if (authType === "account_subscription") return "Account";
  if (authType === "cloud") return "Cloud";
  return authType;
}

function CompanyStep({ draft, onChange, onBack, onNext }: StepProps) {
  const chooseWorkspace = () => {
    void window.agentCompany.pickDirectory().then((result) => {
      if (result.ok && result.data) onChange({ workspacePath: result.data });
    });
  };
  return (
    <div className="form-grid">
      <h2 className="page-h1">Company</h2>
      <Field label="Company name">
        <input className="input" value={draft.companyName} onChange={(event) => onChange({ companyName: event.target.value })} autoFocus required />
      </Field>
      <Field label="Your name">
        <input className="input" value={draft.employeeName} onChange={(event) => onChange({ employeeName: event.target.value })} required />
      </Field>
      <Field label="Description">
        <textarea className="input" value={draft.companyDescription} onChange={(event) => onChange({ companyDescription: event.target.value })} required />
      </Field>
      <Field label="Workspace path (optional)">
        <div className="row" style={{ gap: 6 }}>
          <input className="input" value={draft.workspacePath} onChange={(event) => onChange({ workspacePath: event.target.value })} placeholder="Choose a folder for agent artifacts" />
          <Button tone="ghost" onClick={chooseWorkspace}><Icon name="folder" size={13} /> Choose</Button>
        </div>
      </Field>
      <Actions onBack={onBack} onNext={onNext} />
    </div>
  );
}

function ModeStep({ draft, onChange, onBack, onNext }: StepProps) {
  return (
    <div className="form-grid">
      <h2 className="page-h1">Mode</h2>
      <p style={{ color: "var(--text-3)", fontSize: 13 }}>How autonomous should the CEO be?</p>
      <ModeCard
        title="AI CEO"
        description="Agents auto-approve hires up to the budget envelope and ship work that clears policy."
        active={draft.executionMode === "ai_ceo"}
        onClick={() => onChange({ executionMode: "ai_ceo" })}
      />
      <ModeCard
        title="AI Co-Founder"
        description="Hires need your stamp; deliverables route through review before shipping."
        active={draft.executionMode === "ai_cofounder"}
        onClick={() => onChange({ executionMode: "ai_cofounder" })}
      />
      <Actions onBack={onBack} onNext={onNext} />
    </div>
  );
}

function MissionStep({
  draft,
  submitting,
  onChange,
  onBack,
}: Omit<StepProps, "onNext"> & { submitting: boolean }) {
  return (
    <div className="form-grid">
      <h2 className="page-h1">Goal</h2>
      <Field label="Goal">
        <input className="input" value={draft.goalTitle} onChange={(event) => onChange({ goalTitle: event.target.value })} required />
      </Field>
      <Field label="Acceptance criteria">
        <textarea className="input" value={draft.goalDescription} onChange={(event) => onChange({ goalDescription: event.target.value })} required />
      </Field>
      <div className="modal-actions" style={{ marginTop: 4 }}>
        <Button onClick={onBack}>Back</Button>
        <Button tone="primary" type="submit" disabled={submitting}>{submitting ? "Launching…" : "Launch"}</Button>
      </div>
    </div>
  );
}

function ModeCard({
  title,
  description,
  active,
  onClick,
}: {
  title: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`option-card ${active ? "active" : ""}`.trim()} onClick={onClick}>
      <div className="opt-title">{title}</div>
      <div className="opt-sub">{description}</div>
    </button>
  );
}

function Actions({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="modal-actions" style={{ marginTop: 4 }}>
      <Button onClick={onBack}>Back</Button>
      <Button tone="primary" onClick={onNext}>Continue</Button>
    </div>
  );
}

function requireProvider(providers: ProviderCatalogEntry[], key: string): ProviderCatalogEntry {
  const provider = providers.find((entry) => entry.key === key);
  if (!provider) throw new Error("Provider selection is invalid.");
  return provider;
}

function validateProvider(draft: Draft, providers: ProviderCatalogEntry[]): string | null {
  if (!draft.providerKey) return "Pick a provider.";
  const selected = providers.find((entry) => entry.key === draft.providerKey);
  if (!selected) return "Provider is no longer available.";
  if (!draft.providerSecret.trim()) {
    return selected.authType === "api_key" ? "API key is required." : "Access token is required.";
  }
  if (!draft.providerModel.trim()) return "Model is required.";
  return null;
}

function validateCompany(draft: Draft): string | null {
  if (!draft.companyName.trim()) return "Company name is required.";
  if (!draft.employeeName.trim()) return "Your name is required.";
  if (!draft.companyDescription.trim()) return "Description is required.";
  return null;
}

function validateAll(draft: Draft, providers: ProviderCatalogEntry[]): string | null {
  return validateProvider(draft, providers) ?? validateCompany(draft) ?? (!draft.goalTitle.trim() ? "Goal is required." : null);
}
