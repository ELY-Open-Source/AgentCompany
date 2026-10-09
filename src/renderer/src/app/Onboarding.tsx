import { AutonomySummary } from "./AutonomySummary";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { RestartForLanguage } from "../pages/settings/LanguageField";
import type { OnboardingDraft } from "../../../shared/commands";
import {
  PROVIDER_AUTH_TYPE,
  type AppSnapshot,
  type ProviderCatalogEntry,
  type UiLanguage,
} from "../../../shared/domain";
import { Button, Field, Icon, IconButton, Pill, Segmented } from "../shared/ui";
import type { SnapshotActions } from "./useSnapshot";
import { ProviderStep } from "./OnboardingProviderStep";
import { ConnectorsStep } from "./OnboardingConnectorsStep";
import { t } from "../i18n/i18n";

type Step = OnboardingDraft["step"] | "connectors";

/** The wizard's fields; only the key is never saved between launches. */
export type Draft = Omit<OnboardingDraft, "step"> & { providerSecret: string };

const SAVE_DELAY_MS = 400;

const STEPS: Array<{ id: Step; label: string }> = [
  { id: "welcome", label: t("Start") },
  { id: "provider", label: t("Provider") },
  { id: "company", label: t("Company") },
  { id: "mode", label: t("Mode") },
  { id: "mission", label: t("Goal") },
  { id: "connectors", label: t("Connectors") },
];

export function Onboarding({
  snapshot,
  actions,
  onCancel,
  resumeOrgId,
  onCompleted,
}: {
  snapshot: AppSnapshot;
  actions: SnapshotActions;
  onCancel: (() => void) | null;
  /** A created company whose setup was not finished: the wizard reopens on its connectors step. */
  resumeOrgId: string | null;
  onCompleted: () => void;
}) {
  const availableProviders = useMemo(
    () => snapshot.providerCatalog.filter((entry) => entry.authType !== PROVIDER_AUTH_TYPE.CLOUD || Boolean(entry.customEndpoint)),
    [snapshot.providerCatalog],
  );
  const firstProvider = availableProviders[0];
  if (!firstProvider) throw new Error("Provider catalog must include at least one non-cloud provider.");

  const saved = resumeOrgId ? null : snapshot.onboardingDraft;
  const [step, setStep] = useState<Step>(resumeOrgId ? "connectors" : saved?.step ?? "welcome");
  const [draft, setDraft] = useState<Draft>(() => {
    if (!saved) {
      return {
        companyName: "", companyDescription: "", employeeName: "", workspacePath: "", executionMode: "ai_ceo", providerKey: firstProvider.key,
        providerSecret: "", providerBaseUrl: "", providerModel: "", goalTitle: "", goalDescription: "",
      };
    }
    const fields: Partial<OnboardingDraft> = { ...saved };
    delete fields.step;
    return { ...(fields as Omit<OnboardingDraft, "step">), providerSecret: "" };
  });
  const [restored] = useState(saved !== null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bootstrappedOrgId, setBootstrappedOrgId] = useState<string | null>(resumeOrgId);

  // Saves the wizard (without the key) as it is filled in, so a restart resumes it; stops once the company exists.
  useEffect(() => {
    if (step === "connectors" || submitting || bootstrappedOrgId) return;
    const fields: Partial<Draft> = { ...draft };
    delete fields.providerSecret;
    const timer = setTimeout(() => {
      void window.agentCompany.saveOnboardingDraft({ draft: { ...(fields as Omit<OnboardingDraft, "step">), step } }).then((result) => {
        if (!result.ok) setError(t("Your progress could not be saved: {error}", { error: result.error.message }));
      });
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, step, submitting, bootstrappedOrgId]);

  // The snapshot is reloaded too, so reopening the wizard does not bring back the cancelled draft.
  const cancel = onCancel && (() => {
    void window.agentCompany.saveOnboardingDraft({ draft: null }).then(async (result) => {
      if (!result.ok) return setError(result.error.message);
      await actions.reload();
      onCancel();
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  });

  const finishSetup = (orgId: string) => {
    void actions.run(() => window.agentCompany.completeSetup({ orgId }))
      .then((result) => { if (result) onCompleted(); })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  };

  const selectedProvider = requireProvider(availableProviders, draft.providerKey);
  const isMac = window.agentCompany.platform === "darwin";
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
    const providerSecret = selectedProvider.customEndpoint
      ? JSON.stringify({ baseUrl: draft.providerBaseUrl.trim(), secret: draft.providerSecret.trim() })
      : draft.providerSecret.trim();
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
      providerSecret,
      providerModel: draft.providerModel.trim(),
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setBootstrappedOrgId(result.data.orgId);
    await actions.reload();
    setStep("connectors");
  };

  return (
    <div className="onboarding-window">
      <header className="onboarding-titlebar">
        {!isMac && (
          <span className="window-controls">
            <IconButton icon="minus" label={t("Minimize")} onClick={() => void window.agentCompany.windowMinimize()} />
            <IconButton icon="grid" label={t("Maximize")} onClick={() => void window.agentCompany.windowMaximize()} />
            <IconButton icon="x" label={t("Close")} onClick={() => void window.agentCompany.windowClose()} />
          </span>
        )}
      </header>
      <main className="onboarding-shell">
      <section className="onboarding-hero">
        <div>
          <div className="row" style={{ gap: 8 }}>
            <div className="brand-mark">A</div>
            <div>AgentCompany</div>
            {cancel && step !== "connectors" && (
              <button type="button" className="button ghost" style={{ marginLeft: "auto" }} onClick={cancel}>
                {t("Cancel")}
              </button>
            )}
          </div>
          <h1 className="page-h1" style={{ fontSize: "var(--fs-display)", marginTop: 32 }}>{t("Start your AI company.")}</h1>
          <p className="page-sub" style={{ maxWidth: 460, fontSize: "var(--fs-body)", lineHeight: 1.55 }}>
            {t("Stand up the workspace, bind the provider, and queue the first operating loop.")}
          </p>
          <div className="onboarding-steps">
            {STEPS.map((entry) => (
              <span key={entry.id} aria-current={entry.id === step ? "step" : undefined} className={`step-chip ${entry.id === step ? "active" : ""}`}>{entry.label}</span>
            ))}
          </div>
        </div>
        <div className="card" style={{ maxWidth: 460 }}>
          <div className="card-label" style={{ marginBottom: 10 }}>{t("Runtime selected")}</div>
          <div className="row" style={{ gap: 10 }}>
            <Icon name="bot" />
            <strong style={{ fontSize: "var(--fs-body)" }}>{selectedProvider.label}</strong>
            {draft.providerModel && <Pill tone="violet">{draft.providerModel}</Pill>}
          </div>
          <div style={{ marginTop: 10, fontSize: "var(--fs-body)", color: "var(--text-3)" }}>
            {t("We never embed the key in the build. Credentials encrypt locally via OS-protected storage.")}
          </div>
        </div>
      </section>

      <form className="onboarding-panel" onSubmit={submit} noValidate>
        <div key={step} className="step-view">
          {restored && step !== "connectors" && (
            <p role="status" style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", margin: "0 0 12px" }}>
              {t("Your progress was restored. Keys are never saved before launch, so enter yours again.")}
            </p>
          )}
          {step === "welcome" && (
            <WelcomeStep
              language={snapshot.uiPreferences.language}
              onLanguage={(language) => void actions.run(() => window.agentCompany.setUiPreferences({ language }))}
              onNext={() => setStep("provider")}
            />
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
          {step === "connectors" && bootstrappedOrgId && (
            <ConnectorsStep
              orgId={bootstrappedOrgId}
              snapshot={snapshot}
              actions={actions}
              onFinish={() => finishSetup(bootstrappedOrgId)}
            />
          )}
        </div>
        {error && <div style={{ color: "var(--red)", marginTop: 16, fontSize: "var(--fs-body)" }}>{error}</div>}
      </form>
      </main>
    </div>
  );
}

interface StepProps {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  onBack: () => void;
  onNext: () => void;
}

function WelcomeStep({
  language,
  onLanguage,
  onNext,
}: {
  language: UiLanguage;
  onLanguage: (language: UiLanguage) => void;
  onNext: () => void;
}) {
  return (
    <div className="form-grid">
      <div className="row">
        <h2 className="page-h1" style={{ margin: 0, flex: 1 }}>{t("Welcome")}</h2>
        <Segmented
          label={t("Language")}
          value={language}
          onChange={(next) => { if (next !== language) onLanguage(next); }}
          options={[{ id: "en", label: "English" }, { id: "zh", label: "中文" }]}
        />
      </div>
      <RestartForLanguage language={language} />
      <p style={{ color: "var(--text-2)", fontSize: "var(--fs-body)", lineHeight: 1.55 }}>
        {t("AgentCompany sets up your operating loop in six steps. Bring an API key, pick a runtime for the founding CEO, and we'll wire up the first goal, project, and task.")}
      </p>
      <ul style={{ paddingLeft: 20, color: "var(--text-2)", lineHeight: 1.8, margin: 0, fontSize: "var(--fs-body)" }}>
        <li>{t("Connect one model provider (OpenAI, Anthropic, xAI, or Groq).")}</li>
        <li>{t("Name the company and the human board chair.")}</li>
        <li>{t("Pick execution mode and bind the workspace path.")}</li>
        <li>{t("State the first goal — we kick off the rest.")}</li>
      </ul>
      <div className="modal-actions" style={{ marginTop: 4 }}>
        <Button tone="primary" onClick={onNext}>{t("Get started")}</Button>
      </div>
    </div>
  );
}

function CompanyStep({ draft, onChange, onBack, onNext }: StepProps) {
  const chooseWorkspace = () => {
    void window.agentCompany.pickDirectory().then((result) => {
      if (result.ok && result.data) onChange({ workspacePath: result.data });
    });
  };
  return (
    <div className="form-grid">
      <h2 className="page-h1">{t("Company")}</h2>
      <Field label={t("Company name")}>
        <input className="input" value={draft.companyName} onChange={(event) => onChange({ companyName: event.target.value })} autoFocus required />
      </Field>
      <Field label={t("Your name")}>
        <input className="input" value={draft.employeeName} onChange={(event) => onChange({ employeeName: event.target.value })} required />
      </Field>
      <Field label={t("Description")}>
        <textarea className="input" value={draft.companyDescription} onChange={(event) => onChange({ companyDescription: event.target.value })} required />
      </Field>
      <Field label={t("Workspace path (optional)")}>
        <div className="row" style={{ gap: 6 }}>
          <input className="input" value={draft.workspacePath} onChange={(event) => onChange({ workspacePath: event.target.value })} />
          <Button tone="ghost" onClick={chooseWorkspace}><Icon name="folder" /> {t("Choose")}</Button>
        </div>
      </Field>
      <Actions onBack={onBack} onNext={onNext} />
    </div>
  );
}

function ModeStep({ draft, onChange, onBack, onNext }: StepProps) {
  return (
    <div className="form-grid">
      <h2 className="page-h1">{t("Mode")}</h2>
      <p style={{ color: "var(--text-3)", fontSize: "var(--fs-body)" }}>{t("How autonomous should the CEO be?")}</p>
      <ModeCard
        title={t("AI CEO")}
        description={t("Runs on its own: approves its risky work and large hires, and writes deliverables without review.")}
        active={draft.executionMode === "ai_ceo"}
        onClick={() => onChange({ executionMode: "ai_ceo" })}
      />
      <ModeCard
        title={t("AI Co-Founder")}
        description={t("Checks with you: risky work and large hires wait for you, and deliverables wait for your review.")}
        active={draft.executionMode === "ai_cofounder"}
        onClick={() => onChange({ executionMode: "ai_cofounder" })}
      />
      <AutonomySummary mode={draft.executionMode} />
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
      <h2 className="page-h1">{t("Goal")}</h2>
      <Field label={t("Goal")}>
        <input className="input" value={draft.goalTitle} onChange={(event) => onChange({ goalTitle: event.target.value })} required />
      </Field>
      <Field label={t("Acceptance criteria")}>
        <textarea className="input" value={draft.goalDescription} onChange={(event) => onChange({ goalDescription: event.target.value })} required />
      </Field>
      <div className="modal-actions" style={{ marginTop: 4 }}>
        <Button onClick={onBack}>{t("Back")}</Button>
        <Button tone="primary" type="submit" disabled={submitting}>{submitting ? t("Launching…") : t("Launch")}</Button>
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
    <button type="button" aria-pressed={active} className={`option-card ${active ? "active" : ""}`.trim()} onClick={onClick}>
      <div className="opt-title">{title}</div>
      <div className="opt-sub">{description}</div>
    </button>
  );
}

function Actions({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="modal-actions" style={{ marginTop: 4 }}>
      <Button onClick={onBack}>{t("Back")}</Button>
      <Button tone="primary" onClick={onNext}>{t("Continue")}</Button>
    </div>
  );
}

function requireProvider(providers: ProviderCatalogEntry[], key: string): ProviderCatalogEntry {
  const provider = providers.find((entry) => entry.key === key);
  if (!provider) throw new Error("Provider selection is invalid.");
  return provider;
}

function validateProvider(draft: Draft, providers: ProviderCatalogEntry[]): string | null {
  if (!draft.providerKey) return t("Pick a provider.");
  const selected = providers.find((entry) => entry.key === draft.providerKey);
  if (!selected) return t("Provider is no longer available.");
  if (selected.customEndpoint && !draft.providerBaseUrl.trim()) return t("Base URL is required.");
  // A custom endpoint may be a local server that takes no key.
  if (!draft.providerSecret.trim() && !selected.customEndpoint) {
    return selected.authType === "api_key" ? t("API key is required.") : t("Access token is required.");
  }
  if (!draft.providerModel.trim()) return t("Model is required.");
  return null;
}

function validateCompany(draft: Draft): string | null {
  if (!draft.companyName.trim()) return t("Company name is required.");
  if (!draft.employeeName.trim()) return t("Your name is required.");
  if (!draft.companyDescription.trim()) return t("Description is required.");
  return null;
}

function validateAll(draft: Draft, providers: ProviderCatalogEntry[]): string | null {
  return validateProvider(draft, providers) ?? validateCompany(draft) ?? (!draft.goalTitle.trim() ? t("Goal is required.") : null);
}
