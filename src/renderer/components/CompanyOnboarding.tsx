import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Buildings,
  CheckCircle,
  Cpu,
  FolderOpen,
  Lightning,
  Rocket,
  Target,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import type { OnboardingBootstrapResult, ProfileSnapshot } from "@shared/types";
import { unwrap } from "../lib/desktop";
import { ActionButton, Input, Select, TextArea } from "./ui";

type Step = "company" | "mission" | "launch";

export function CompanyOnboarding({
  connectors,
  onDone,
  canCancel = false,
  onCancel,
}: {
  connectors: ProfileSnapshot["connectors"];
  onDone: (summary: OnboardingBootstrapResult) => Promise<void>;
  canCancel?: boolean;
  onCancel?: () => void;
}) {
  const [step, setStep] = useState<Step>("company");
  const [companyName, setCompanyName] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [autoApproveHires, setAutoApproveHires] = useState(true);
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDescription, setGoalDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchSummary, setLaunchSummary] = useState<OnboardingBootstrapResult | null>(null);

  const readyConnectors = useMemo(
    () => connectors.filter((connector) => connector.status === "ready" || connector.status === "degraded"),
    [connectors],
  );
  const [selectedConnectorId, setSelectedConnectorId] = useState<string>(readyConnectors[0]?.id ?? "");
  const hasRunnableConnector = readyConnectors.length > 0;
  const selectedConnector = readyConnectors.find((connector) => connector.id === selectedConnectorId) ?? readyConnectors[0] ?? null;

  useEffect(() => {
    if (!selectedConnectorId && readyConnectors[0]) {
      setSelectedConnectorId(readyConnectors[0].id);
      return;
    }
    if (selectedConnectorId && !readyConnectors.some((connector) => connector.id === selectedConnectorId)) {
      setSelectedConnectorId(readyConnectors[0]?.id ?? "");
    }
  }, [readyConnectors, selectedConnectorId]);

  const stepLabels = [
    { label: "Company", icon: Buildings },
    { label: "Mission", icon: Target },
    { label: "Launch", icon: Rocket },
  ] as const;
  const stepIndex = step === "company" ? 0 : step === "mission" ? 1 : 2;

  const pickDirectory = useCallback(async () => {
    setError(null);
    const result = await window.agentCompany.pickDirectory();
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (result.data) {
      setWorkspacePath(result.data);
    }
  }, []);

  const bootstrap = useCallback(async () => {
    const result = unwrap(await window.agentCompany.bootstrapOnboarding({
      companyName: companyName.trim(),
      companyDescription: companyDescription.trim(),
      workspacePath: workspacePath.trim(),
      autoApproveHires,
      goalTitle: goalTitle.trim(),
      goalDescription: goalDescription.trim(),
      connectorId: selectedConnector?.id,
    }));
    setLaunchSummary(result);
    setStep("launch");
  }, [
    autoApproveHires,
    companyDescription,
    companyName,
    goalDescription,
    goalTitle,
    selectedConnector?.id,
    workspacePath,
  ]);

  const continueToMission = useCallback(async () => {
    if (loading) return;
    if (!companyName.trim()) {
      setError("Enter a company name.");
      return;
    }
    if (!selectedConnector) {
      setError("At least one ready connector is required before you can continue.");
      return;
    }
    setError(null);
    setStep("mission");
  }, [companyName, loading, selectedConnector]);

  const launchCompany = useCallback(async () => {
    if (loading) return;
    if (!goalTitle.trim()) {
      setError("Describe the first real company goal.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await bootstrap();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to bootstrap the company.");
    } finally {
      setLoading(false);
    }
  }, [bootstrap, goalTitle, loading]);

  const finishLaunch = useCallback(async () => {
    if (!launchSummary) return;
    setLoading(true);
    setError(null);
    try {
      await onDone(launchSummary);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to open the control center.");
    } finally {
      setLoading(false);
    }
  }, [launchSummary, onDone]);

  return (
    <div className="grid min-h-[100dvh] overflow-hidden bg-[color:var(--bg)] md:grid-cols-[minmax(0,1fr)_540px]">
      <div className="flex min-h-0 items-center justify-center overflow-y-auto px-8 py-12 md:px-16">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto w-full max-w-[460px]"
        >
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">
            AgentCompany Desktop
          </div>
          <h1 className="text-[38px] leading-[0.98] tracking-[-0.03em] text-[color:var(--text)] md:text-[48px]">
            Start a real local-first
            <br />
            agent company.
          </h1>
          <p className="mt-4 max-w-[400px] text-[14px] leading-relaxed text-[color:var(--muted)]">
            This flow creates one company, binds a real connector, links an optional workspace, writes the first goal,
            creates the operating project, and queues the first execution task.
          </p>

          <div className="mt-10 flex items-center gap-3">
            {stepLabels.map((entry, index) => (
              <div key={entry.label} className="flex items-center gap-2">
                {index > 0 ? (
                  <div className={`h-px w-6 ${index <= stepIndex ? "bg-[color:var(--accent)]" : "bg-[color:var(--line)]"}`} />
                ) : null}
                <div
                  className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium ${
                    index < stepIndex
                      ? "bg-[color:var(--success-soft)] text-[color:var(--success)]"
                      : index === stepIndex
                        ? "bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
                        : "bg-[color:var(--panel-soft)] text-[color:var(--muted)]"
                  }`}
                >
                  {index < stepIndex ? <CheckCircle size={14} weight="fill" /> : <entry.icon size={14} />}
                  {entry.label}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10">
            <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">
              Connector readiness
            </div>
            <div className="space-y-2.5">
              {connectors.map((connector) => {
                const isRunnable = connector.status === "ready" || connector.status === "degraded";
                const isMissing = connector.status === "not_installed";
                return (
                  <div key={connector.id} className="flex items-center gap-2.5 text-[13px]">
                    {isRunnable ? (
                      <CheckCircle size={16} weight="fill" className="shrink-0 text-[color:var(--success)]" />
                    ) : isMissing ? (
                      <XCircle size={16} weight="fill" className="shrink-0 text-[color:var(--muted)]" />
                    ) : (
                      <WarningCircle size={16} weight="fill" className="shrink-0 text-[color:var(--warn)]" />
                    )}
                    <span className={isRunnable ? "font-medium text-[color:var(--text)]" : "text-[color:var(--muted)]"}>
                      {connector.label}
                    </span>
                    <span className="text-[11px] text-[color:var(--muted)]">
                      {connector.status.replaceAll("_", " ")}
                    </span>
                  </div>
                );
              })}
            </div>
            {!hasRunnableConnector ? (
              <div className="mt-4 rounded-[10px] border border-[color:var(--warn)] bg-[color:var(--warn-soft)] px-4 py-3 text-[12px] text-[color:var(--warn)]">
                Install and authenticate at least one supported CLI runtime before creating the company.
              </div>
            ) : null}
          </div>
        </motion.div>
      </div>

      <div className="min-h-0 overflow-y-auto border-l border-[color:var(--line)] bg-[color:var(--bg-subtle)]">
        <div className="relative flex min-h-full items-center px-6 py-10 md:px-10">
          {canCancel && onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="absolute right-6 top-6 text-[12px] font-medium text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
            >
              Cancel
            </button>
          ) : null}

          <AnimatePresence mode="wait">
            {step === "company" ? (
              <motion.div
                key="company"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -18 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                className="surface w-full rounded-[12px] p-7"
              >
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">
                  Step 1 of 3
                </div>
                <div className="mb-1 text-[18px] font-semibold tracking-[-0.01em] text-[color:var(--text)]">
                  Create the operating boundary
                </div>
                <div className="mb-6 h-px bg-[color:var(--line)]" />

                <div className="space-y-4">
                  <Input
                    label="Company name"
                    value={companyName}
                    onChange={setCompanyName}
                    placeholder="e.g. Northline Systems"
                  />
                  <TextArea
                    label="Company description"
                    value={companyDescription}
                    onChange={setCompanyDescription}
                    placeholder="Optional context for the company operating model."
                    rows={3}
                  />
                  <Select
                    label="Primary connector"
                    value={selectedConnector?.id ?? ""}
                    onChange={setSelectedConnectorId}
                    options={readyConnectors.map((connector) => ({
                      value: connector.id,
                      label: `${connector.label} (${connector.status.replaceAll("_", " ")})`,
                    }))}
                  />
                  <div>
                    <label
                      htmlFor="onboarding-workspace-path"
                      className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]"
                    >
                      Workspace folder <span className="font-normal text-[color:var(--muted)]">(optional)</span>
                    </label>
                    <div className="flex gap-3">
                      <Input
                        id="onboarding-workspace-path"
                        ariaLabel="Workspace folder"
                        value={workspacePath}
                        onChange={setWorkspacePath}
                        placeholder="/Users/you/project"
                      />
                      <ActionButton label="Choose" onClick={() => void pickDirectory()} icon={FolderOpen} />
                    </div>
                    <div className="mt-1.5 text-[11px] text-[color:var(--muted)]">
                      If set, the first execution task will be bound to this path and the path will be registered as the primary workspace.
                    </div>
                  </div>
                  <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={autoApproveHires}
                        onChange={(event) => setAutoApproveHires(event.target.checked)}
                        className="h-4 w-4 rounded border-[color:var(--line)] accent-[color:var(--accent)]"
                      />
                      <div>
                        <div className="text-[13px] font-medium text-[color:var(--text)]">Auto-approve hire and strategy approvals</div>
                        <div className="mt-0.5 text-[11px] text-[color:var(--muted)]">
                          Useful for single-operator flows. Leave it off if you want the board to gate organization changes explicitly.
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                {error ? (
                  <div className="mt-5 rounded-[10px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-[color:var(--danger)]">
                    {error}
                  </div>
                ) : null}

                <div className="mt-8 flex items-center justify-end">
                  <ActionButton
                    label="Continue"
                    onClick={() => void continueToMission()}
                    icon={Buildings}
                    tone="accent"
                    disabled={!companyName.trim() || !selectedConnector}
                  />
                </div>
              </motion.div>
            ) : null}

            {step === "mission" ? (
              <motion.div
                key="mission"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -18 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                className="surface w-full rounded-[12px] p-7"
              >
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">
                  Step 2 of 3
                </div>
                <div className="mb-1 text-[18px] font-semibold tracking-[-0.01em] text-[color:var(--text)]">
                  Define the first real goal
                </div>
                <div className="mb-2 text-[13px] text-[color:var(--muted)]">
                  The first goal seeds the operating project and the first task. This should be specific enough that the CEO agent can decompose it into concrete work.
                </div>
                <div className="mb-6 h-px bg-[color:var(--line)]" />

                <div className="space-y-4">
                  <Input
                    label="Goal"
                    value={goalTitle}
                    onChange={setGoalTitle}
                    placeholder="e.g. Ship the first customer-ready desktop demo"
                  />
                  <TextArea
                    label="Acceptance criteria"
                    value={goalDescription}
                    onChange={setGoalDescription}
                    placeholder="Describe what successful execution looks like, what cannot be skipped, and any delivery constraints."
                    rows={5}
                  />
                  <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3 text-[12px] text-[color:var(--muted)]">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">
                      <Cpu size={12} />
                      Execution handoff
                    </div>
                    <div className="space-y-2">
                      <div>The selected connector becomes the CEO agent runtime for the first launch.</div>
                      <div>The app will create the company, the primary workspace, the CEO agent, the kickoff project, and the first task.</div>
                      <div>If the worker is already ready, the first run will be queued immediately; otherwise the scheduler will pick it up once the runtime is available.</div>
                    </div>
                  </div>
                </div>

                {error ? (
                  <div className="mt-5 rounded-[10px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-[color:var(--danger)]">
                    {error}
                  </div>
                ) : null}

                <div className="mt-8 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setStep("company")}
                    className="text-[12px] font-medium text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
                  >
                    Back
                  </button>
                  <ActionButton
                    label={loading ? "Launching..." : "Launch Company"}
                    onClick={() => void launchCompany()}
                    icon={Lightning}
                    tone="accent"
                    loading={loading}
                    disabled={!goalTitle.trim()}
                  />
                </div>
              </motion.div>
            ) : null}

            {step === "launch" && launchSummary ? (
              <motion.div
                key="launch"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
                className="surface w-full rounded-[12px] p-7"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--success-soft)] text-[color:var(--success)]">
                  <CheckCircle size={24} weight="fill" />
                </div>
                <h2 className="mt-5 text-[28px] tracking-[-0.03em] text-[color:var(--text)]">
                  {launchSummary.companyName} is live.
                </h2>
                <p className="mt-3 text-[14px] leading-relaxed text-[color:var(--muted)]">
                  The company shell is created. The first project and task are registered, and the kickoff execution is
                  {launchSummary.runId ? " queued." : " prepared for deferred execution once the runtime is ready."}
                </p>

                <div className="mt-6 grid gap-3 md:grid-cols-2">
                  <div className="rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Connector</div>
                    <div className="mt-1 text-[13px] font-medium text-[color:var(--text)]">
                      {selectedConnector?.label ?? "Unavailable"}
                    </div>
                  </div>
                  <div className="rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Lead agent</div>
                    <div className="mt-1 text-[13px] font-medium text-[color:var(--text)]">
                      {launchSummary.leadAgentId ? "CEO agent created" : "Lead agent unavailable"}
                    </div>
                  </div>
                  <div className="rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Primary workspace</div>
                    <div className="mt-1 text-[13px] font-medium text-[color:var(--text)]">
                      {launchSummary.workspaceId ? "Registered" : "Not bound"}
                    </div>
                  </div>
                  <div className="rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Kickoff project</div>
                    <div className="mt-1 text-[13px] font-medium text-[color:var(--text)]">
                      {launchSummary.projectId ? "Created" : "Unavailable"}
                    </div>
                  </div>
                  <div className="rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Initial run</div>
                    <div className="mt-1 text-[13px] font-medium text-[color:var(--text)]">
                      {launchSummary.runId ? "Queued in orchestration" : "Deferred until runtime is ready"}
                    </div>
                  </div>
                </div>

                {error ? (
                  <div className="mt-5 rounded-[10px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-[color:var(--danger)]">
                    {error}
                  </div>
                ) : null}

                <div className="mt-8 flex items-center justify-end">
                  <ActionButton
                    label={loading ? "Opening..." : "Open Control Center"}
                    onClick={() => void finishLaunch()}
                    icon={Rocket}
                    tone="accent"
                    loading={loading}
                  />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
