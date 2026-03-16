import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Buildings,
  CheckCircle,
  FolderOpen,
  Lightning,
  Robot,
  Rocket,
  Target,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import type { ProfileSnapshot } from "@shared/types";
import { unwrap } from "../lib/desktop";
import { ActionButton, Input, TextArea } from "./ui";

type Step = "company" | "goal" | "launch";

export function CompanyOnboarding({
  connectors,
  onDone,
}: {
  connectors: ProfileSnapshot["connectors"];
  onDone: () => Promise<void>;
}) {
  const [step, setStep] = useState<Step>("company");
  const [companyName, setCompanyName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [autoApproveHires, setAutoApproveHires] = useState(true);
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDescription, setGoalDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCompanyId, setCreatedCompanyId] = useState<string | null>(null);

  const hasReadyConnector = connectors.some((c) => c.status === "ready" || c.status === "degraded");
  const readyConnectors = connectors.filter((c) => c.status === "ready" || c.status === "degraded");
  const bestConnector = readyConnectors[0] ?? null;

  async function pickDirectory() {
    setError(null);
    const result = await window.agentCompany.pickDirectory();
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (result.data) {
      setWorkspacePath(result.data);
    }
  }

  const createCompany = useCallback(async () => {
    if (loading) return;
    if (!companyName.trim()) {
      setError("Enter a company name.");
      return;
    }
    if (!hasReadyConnector) {
      setError("At least one connector must be detected before creating a company.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const companyId = unwrap(
        await window.agentCompany.saveCompany({
          name: companyName.trim(),
          description: "",
          status: "active",
          autoApproveHires,
        }),
      );
      if (workspacePath) {
        unwrap(
          await window.agentCompany.saveWorkspace({
            companyId,
            name: "Default Workspace",
            localPath: workspacePath,
            repoUrl: "",
            repoRef: "",
            isPrimary: true,
          }),
        );
      }
      unwrap(await window.agentCompany.setCurrentCompany(companyId));
      setCreatedCompanyId(companyId);
      setStep("goal");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create the company.");
    } finally {
      setLoading(false);
    }
  }, [loading, companyName, hasReadyConnector, autoApproveHires, workspacePath]);

  const createGoalAndLaunch = useCallback(async () => {
    if (loading || !createdCompanyId) return;
    setLoading(true);
    setError(null);
    try {
      // Create goal
      if (goalTitle.trim()) {
        unwrap(
          await window.agentCompany.saveGoal({
            companyId: createdCompanyId,
            title: goalTitle.trim(),
            description: goalDescription.trim() || `Achieve: ${goalTitle.trim()}`,
            status: "active",
            parentId: null,
            ownerAgentId: null,
          }),
        );
      }

      // Create CEO agent automatically
      if (bestConnector) {
        const ceoId = unwrap(
          await window.agentCompany.saveAgent({
            companyId: createdCompanyId,
            name: "CEO",
            role: "CEO",
            title: "Chief Executive Officer",
            reportsTo: null,
            connectorId: bestConnector.id,
            workspaceId: null,
            model: null,
            capabilities: "Executive leadership, strategic planning, team building, goal decomposition, delegation, and organizational management. Responsible for hiring the leadership team, setting strategy, and coordinating all company operations.",
            budgetMonthlyUsd: 250,
            status: "idle",
          }),
        );

        // Enable heartbeat on CEO for autonomous operation
        unwrap(await window.agentCompany.setHeartbeat({ agentId: ceoId, companyId: createdCompanyId, enabled: true, intervalSec: 120 }));

        setStep("launch");

        // Auto-trigger the CEO's first run after a brief delay for UI
        setTimeout(async () => {
          try {
            await window.agentCompany.triggerHeartbeat({ agentId: ceoId, companyId: createdCompanyId, trigger: "assignment" });
          } catch {
            // Non-fatal — CEO will wake on next heartbeat cycle
          }
        }, 1500);
      }

      await onDone();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to set up the company.");
      setLoading(false);
    }
  }, [loading, createdCompanyId, goalTitle, goalDescription, bestConnector, onDone]);

  const skipGoalAndFinish = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await onDone();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to continue.");
    } finally {
      setLoading(false);
    }
  }, [loading, onDone]);

  const stepIndex = step === "company" ? 0 : step === "goal" ? 1 : 2;

  return (
    <div className="grid min-h-[100dvh] grid-cols-1 bg-[color:var(--bg)] md:grid-cols-[minmax(0,1fr)_480px]">
      {/* Left panel — branding */}
      <div className="flex items-center px-8 py-12 md:px-16">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-[440px]"
        >
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">AgentCompany Desktop</div>
          <h1 className="text-[38px] leading-[0.98] tracking-[-0.03em] text-[color:var(--text)] md:text-[48px]">
            Build your<br />AI company.
          </h1>
          <p className="mt-4 max-w-[380px] text-[14px] leading-relaxed text-[color:var(--muted)]">
            Set up a fully autonomous AI-powered organization. Your agents will hire, delegate, execute, review, and coordinate — just like a real company.
          </p>

          {/* Step indicators */}
          <div className="mt-10 flex items-center gap-3">
            {[
              { label: "Create Company", icon: Buildings },
              { label: "Set Mission", icon: Target },
              { label: "Launch", icon: Rocket },
            ].map((s, i) => (
              <div key={s.label} className="flex items-center gap-2">
                {i > 0 ? <div className={`h-px w-6 ${i <= stepIndex ? "bg-[color:var(--accent)]" : "bg-[color:var(--line)]"}`} /> : null}
                <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium ${
                  i < stepIndex
                    ? "bg-[color:var(--success-soft)] text-[color:var(--success)]"
                    : i === stepIndex
                      ? "bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
                      : "bg-[color:var(--panel-soft)] text-[color:var(--muted)]"
                }`}>
                  {i < stepIndex ? <CheckCircle size={14} weight="fill" /> : <s.icon size={14} />}
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* Detected connectors */}
          <div className="mt-10">
            <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Detected agents</div>
            <div className="space-y-2.5">
              {connectors.map((c) => {
                const isOk = c.status === "ready" || c.status === "degraded";
                const isFail = c.status === "not_installed";
                return (
                  <div key={c.id} className="flex items-center gap-2.5 text-[13px]">
                    {isOk ? (
                      <CheckCircle size={16} weight="fill" className="shrink-0 text-[color:var(--success)]" />
                    ) : isFail ? (
                      <XCircle size={16} weight="fill" className="shrink-0 text-[color:var(--muted)]" />
                    ) : (
                      <WarningCircle size={16} weight="fill" className="shrink-0 text-[color:var(--warn)]" />
                    )}
                    <span className={isOk ? "font-medium text-[color:var(--text)]" : "text-[color:var(--muted)]"}>
                      {c.label}
                    </span>
                    <span className="text-[11px] text-[color:var(--muted)]">
                      {c.status.replaceAll("_", " ")}
                    </span>
                  </div>
                );
              })}
            </div>
            {!hasReadyConnector && (
              <div className="mt-4 rounded-[10px] border border-[color:var(--warn)] bg-[color:var(--warn-soft)] px-4 py-3 text-[12px] text-[color:var(--warn)]">
                No connector detected. Install at least one supported CLI tool (Claude Code, Codex, Gemini CLI, OpenCode, or Kimi Code) and restart.
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Right panel — form steps */}
      <div className="flex items-center border-l border-[color:var(--line)] bg-[color:var(--bg-subtle)] px-6 py-10 md:px-10">
        <AnimatePresence mode="wait">
          {step === "company" ? (
            <motion.div
              key="company"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="surface w-full rounded-[12px] p-7"
            >
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Step 1 of 3</div>
              <div className="mb-1 text-[18px] font-semibold tracking-[-0.01em] text-[color:var(--text)]">Create your company</div>
              <div className="mb-6 h-px bg-[color:var(--line)]" />
              <div className="space-y-4">
                <Input label="Company name" value={companyName} onChange={setCompanyName} placeholder="e.g. Acme AI Labs" />
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
                    The directory where your agents will work. You can add more later.
                  </div>
                </div>

                {/* Auto-approve toggle */}
                <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={autoApproveHires}
                      onChange={(e) => setAutoApproveHires(e.target.checked)}
                      className="h-4 w-4 rounded border-[color:var(--line)] accent-[color:var(--accent)]"
                    />
                    <div>
                      <div className="text-[13px] font-medium text-[color:var(--text)]">Full Autonomy Mode</div>
                      <div className="mt-0.5 text-[11px] text-[color:var(--muted)]">
                        Auto-approve agent hires and org strategies. Agents will build the team without waiting for Board approval.
                      </div>
                    </div>
                  </label>
                </div>
              </div>
              {error ? (
                <div className="mt-5 rounded-[10px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-[color:var(--danger)]" role="alert">
                  {error}
                </div>
              ) : null}
              <div className="mt-8 flex items-center justify-end gap-4">
                <ActionButton
                  label={loading ? "Creating..." : "Continue"}
                  onClick={() => void createCompany()}
                  icon={Buildings}
                  tone="accent"
                  loading={loading}
                  disabled={!hasReadyConnector || !companyName.trim()}
                />
              </div>
            </motion.div>
          ) : step === "goal" ? (
            <motion.div
              key="goal"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="surface w-full rounded-[12px] p-7"
            >
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Step 2 of 3</div>
              <div className="mb-1 text-[18px] font-semibold tracking-[-0.01em] text-[color:var(--text)]">Set your company's mission</div>
              <div className="mb-2 text-[13px] text-[color:var(--muted)]">
                What should your AI company accomplish? The CEO agent will use this to build a team and start working.
              </div>
              <div className="mb-6 h-px bg-[color:var(--line)]" />
              <div className="space-y-4">
                <Input
                  label="Goal"
                  value={goalTitle}
                  onChange={setGoalTitle}
                  placeholder="e.g. Build a SaaS landing page with marketing copy"
                />
                <TextArea
                  label="Description (acceptance criteria)"
                  value={goalDescription}
                  onChange={setGoalDescription}
                  placeholder="Describe what 'done' looks like. The more specific, the better."
                  rows={4}
                />
              </div>

              {/* Preview: what will happen */}
              <div className="mt-5 rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">What happens next</div>
                <div className="space-y-2 text-[12px] text-[color:var(--muted)]">
                  <div className="flex items-start gap-2">
                    <Robot size={14} className="mt-0.5 shrink-0 text-[color:var(--accent)]" />
                    <span>A <strong className="text-[color:var(--text)]">CEO agent</strong> will be created using {bestConnector?.label ?? "your best connector"}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Target size={14} className="mt-0.5 shrink-0 text-[color:var(--accent)]" />
                    <span>The CEO will read your goal and <strong className="text-[color:var(--text)]">design an organization structure</strong></span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Lightning size={14} className="mt-0.5 shrink-0 text-[color:var(--accent)]" />
                    <span>Agents will be hired, tasks delegated, and work will begin <strong className="text-[color:var(--text)]">autonomously</strong></span>
                  </div>
                </div>
              </div>

              {error ? (
                <div className="mt-5 rounded-[10px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-[color:var(--danger)]" role="alert">
                  {error}
                </div>
              ) : null}
              <div className="mt-8 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => void skipGoalAndFinish()}
                  className="text-[12px] font-medium text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
                >
                  Skip for now
                </button>
                <ActionButton
                  label={loading ? "Launching..." : "Launch your company"}
                  onClick={() => void createGoalAndLaunch()}
                  icon={Rocket}
                  tone="accent"
                  loading={loading}
                  disabled={!goalTitle.trim()}
                />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="launch"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="w-full text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, duration: 0.6, type: "spring", bounce: 0.4 }}
                className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[color:var(--success-soft)]"
              >
                <Rocket size={36} weight="fill" className="text-[color:var(--success)]" />
              </motion.div>
              <h2 className="text-[24px] font-bold tracking-[-0.02em] text-[color:var(--text)]">
                {companyName} is live!
              </h2>
              <p className="mx-auto mt-3 max-w-[340px] text-[14px] leading-relaxed text-[color:var(--muted)]">
                Your CEO agent is starting up. Watch the dashboard as your company comes to life.
              </p>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.5 }}
                className="mt-8"
              >
                <div className="flex items-center justify-center gap-2 text-[12px] text-[color:var(--muted)]">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[color:var(--success)]" />
                  CEO agent initializing...
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
