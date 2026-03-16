import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Buildings,
  CheckCircle,
  Code,
  Cpu,
  Flask,
  FolderOpen,
  Lightning,
  Megaphone,
  Robot,
  Rocket,
  Stack,
  Target,
  TreeStructure,
  Users,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import type { CompanyTemplate, ProfileSnapshot } from "@shared/types";
import { unwrap } from "../lib/desktop";
import { ActionButton, Input, TextArea } from "./ui";

type Step = "choose" | "template" | "company" | "goal" | "launch";

const templateIcons: Record<string, React.ElementType> = {
  Cpu: Cpu,
  Megaphone: Megaphone,
  Flask: Flask,
  Stack: Stack,
  Code: Code,
};

export function CompanyOnboarding({
  connectors,
  onDone,
}: {
  connectors: ProfileSnapshot["connectors"];
  onDone: () => Promise<void>;
}) {
  const [step, setStep] = useState<Step>("choose");
  const [companyName, setCompanyName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [autoApproveHires, setAutoApproveHires] = useState(true);
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDescription, setGoalDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCompanyId, setCreatedCompanyId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<CompanyTemplate[]>([]);

  const hasReadyConnector = connectors.some((c) => c.status === "ready" || c.status === "degraded");
  const readyConnectors = connectors.filter((c) => c.status === "ready" || c.status === "degraded");
  const bestConnector = readyConnectors[0] ?? null;
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;

  // Load templates
  useEffect(() => {
    window.agentCompany.listCompanyTemplates().then((result) => {
      if (result.ok) setTemplates(result.data);
    });
  }, []);

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

  // Template launch
  const launchFromTemplate = useCallback(async () => {
    if (loading || !selectedTemplate) return;
    if (!companyName.trim()) {
      setError("Enter a company name.");
      return;
    }
    if (!hasReadyConnector) {
      setError("At least one connector must be ready.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const companyId = unwrap(
        await window.agentCompany.applyCompanyTemplate({
          templateId: selectedTemplate.id,
          companyName: companyName.trim(),
          companyDescription: "",
          connectorId: bestConnector?.id,
        }),
      );

      // Create workspace for the company if path provided
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

      setCreatedCompanyId(companyId);
      setStep("launch");
      await onDone();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create the company.");
    } finally {
      setLoading(false);
    }
  }, [loading, selectedTemplate, companyName, hasReadyConnector, workspacePath, bestConnector, onDone]);

  // Custom company creation (existing flow)
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
        unwrap(await window.agentCompany.setHeartbeat({ agentId: ceoId, companyId: createdCompanyId, enabled: true, intervalSec: 120 }));
        setStep("launch");
        setTimeout(async () => {
          try {
            await window.agentCompany.triggerHeartbeat({ agentId: ceoId, companyId: createdCompanyId, trigger: "assignment" });
          } catch { /* Non-fatal */ }
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

  const stepLabels = step === "choose" || step === "template"
    ? [
        { label: "Choose Setup", icon: Lightning },
        { label: "Configure", icon: Buildings },
        { label: "Launch", icon: Rocket },
      ]
    : [
        { label: "Create Company", icon: Buildings },
        { label: "Set Mission", icon: Target },
        { label: "Launch", icon: Rocket },
      ];

  const stepIndex = step === "choose" ? 0 : step === "template" ? 1 : step === "company" ? 0 : step === "goal" ? 1 : 2;

  return (
    <div className="grid min-h-[100dvh] grid-cols-1 bg-[color:var(--bg)] md:grid-cols-[minmax(0,1fr)_520px]">
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
            {stepLabels.map((s, i) => (
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
          {/* ── Step: Choose Mode ────────────────────────── */}
          {step === "choose" ? (
            <motion.div
              key="choose"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="w-full space-y-5"
            >
              <div>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">How would you like to start?</div>
                <div className="text-[18px] font-semibold tracking-[-0.01em] text-[color:var(--text)]">Choose your setup</div>
              </div>

              {/* Template cards */}
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--accent)]">Quick Start — Choose a template</div>
                <div className="grid grid-cols-1 gap-2">
                  {templates.map((template) => {
                    const Icon = templateIcons[template.icon] ?? Cpu;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => {
                          setSelectedTemplateId(template.id);
                          setCompanyName(template.name);
                          setStep("template");
                        }}
                        disabled={!hasReadyConnector}
                        className="focus-ring flex items-start gap-3 rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3 text-left transition hover:border-[color:var(--accent)] hover:shadow-sm disabled:opacity-50"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[color:var(--accent-soft)]">
                          <Icon size={18} className="text-[color:var(--accent)]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold text-[color:var(--text)]">{template.name}</div>
                          <div className="mt-0.5 text-[11px] leading-relaxed text-[color:var(--muted)]">{template.description}</div>
                          <div className="mt-1.5 flex gap-3 text-[10px] text-[color:var(--muted)]">
                            <span className="flex items-center gap-1">
                              <Users size={10} />
                              {template.agents.length} agent{template.agents.length !== 1 ? "s" : ""}
                            </span>
                            <span className="flex items-center gap-1">
                              <Target size={10} />
                              {template.goals.length} goal{template.goals.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-[color:var(--line)]" />
                <span className="text-[10px] font-medium text-[color:var(--muted)]">OR</span>
                <div className="h-px flex-1 bg-[color:var(--line)]" />
              </div>

              {/* Custom option */}
              <button
                type="button"
                onClick={() => setStep("company")}
                disabled={!hasReadyConnector}
                className="focus-ring flex w-full items-center gap-3 rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-4 text-left transition hover:border-[color:var(--line-strong)] hover:shadow-sm disabled:opacity-50"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[color:var(--panel-soft)]">
                  <Buildings size={18} className="text-[color:var(--muted-strong)]" />
                </div>
                <div>
                  <div className="text-[13px] font-semibold text-[color:var(--text)]">Custom Setup</div>
                  <div className="mt-0.5 text-[11px] text-[color:var(--muted)]">Create a company from scratch. Set your own name, goals, and let the CEO build the team.</div>
                </div>
              </button>
            </motion.div>
          ) : step === "template" && selectedTemplate ? (
            /* ── Step: Template Configuration ─────────────── */
            <motion.div
              key="template"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="surface w-full rounded-[12px] p-7"
            >
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Template: {selectedTemplate.name}</div>
              <div className="mb-1 text-[18px] font-semibold tracking-[-0.01em] text-[color:var(--text)]">Configure & Launch</div>
              <div className="mb-6 h-px bg-[color:var(--line)]" />

              <div className="space-y-4">
                <Input label="Company name" value={companyName} onChange={setCompanyName} placeholder="e.g. Acme AI Labs" />
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">
                    Workspace folder <span className="font-normal text-[color:var(--muted)]">(optional)</span>
                  </label>
                  <div className="flex gap-3">
                    <Input ariaLabel="Workspace folder" value={workspacePath} onChange={setWorkspacePath} placeholder="/Users/you/project" />
                    <ActionButton label="Choose" onClick={() => void pickDirectory()} icon={FolderOpen} />
                  </div>
                </div>
              </div>

              {/* Team preview */}
              <div className="mt-5 rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">Team that will be created</div>
                <div className="space-y-1.5">
                  {selectedTemplate.agents.map((agent, i) => (
                    <div key={i} className="flex items-center gap-2 text-[12px]">
                      <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[8px] font-bold ${
                        agent.reportsToIndex === null ? "bg-[color:var(--accent-soft)] text-[color:var(--accent)]" : "bg-[color:var(--panel)] text-[color:var(--muted-strong)]"
                      }`}>
                        {agent.name.split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase()}
                      </div>
                      <span className="font-medium text-[color:var(--text)]">{agent.name}</span>
                      <span className="text-[color:var(--muted)]">— {agent.title}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-3 text-[11px] text-[color:var(--muted)]">
                  <span className="flex items-center gap-1">
                    <TreeStructure size={12} />
                    {selectedTemplate.agents.length} agents
                  </span>
                  <span className="flex items-center gap-1">
                    <Target size={12} />
                    {selectedTemplate.goals.length} goals
                  </span>
                </div>
              </div>

              {/* What happens */}
              <div className="mt-4 rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">What happens next</div>
                <div className="space-y-2 text-[12px] text-[color:var(--muted)]">
                  <div className="flex items-start gap-2">
                    <Users size={14} className="mt-0.5 shrink-0 text-[color:var(--accent)]" />
                    <span>All <strong className="text-[color:var(--text)]">{selectedTemplate.agents.length} agents</strong> are created with roles and budgets</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Target size={14} className="mt-0.5 shrink-0 text-[color:var(--accent)]" />
                    <span>Goals are set and assigned to the <strong className="text-[color:var(--text)]">{selectedTemplate.agents[0]?.role ?? "CEO"}</strong></span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Lightning size={14} className="mt-0.5 shrink-0 text-[color:var(--accent)]" />
                    <span>The team leader starts working <strong className="text-[color:var(--text)]">immediately</strong></span>
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
                  onClick={() => { setStep("choose"); setSelectedTemplateId(null); }}
                  className="text-[12px] font-medium text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
                >
                  Back
                </button>
                <ActionButton
                  label={loading ? "Launching..." : "Launch Company"}
                  onClick={() => void launchFromTemplate()}
                  icon={Rocket}
                  tone="accent"
                  loading={loading}
                  disabled={!companyName.trim() || !hasReadyConnector}
                />
              </div>
            </motion.div>
          ) : step === "company" ? (
            /* ── Step: Custom Company ─────────────────────── */
            <motion.div
              key="company"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="surface w-full rounded-[12px] p-7"
            >
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Custom Setup — Step 1 of 3</div>
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
              <div className="mt-8 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep("choose")}
                  className="text-[12px] font-medium text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
                >
                  Back
                </button>
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
            /* ── Step: Goal ───────────────────────────────── */
            <motion.div
              key="goal"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="surface w-full rounded-[12px] p-7"
            >
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Custom Setup — Step 2 of 3</div>
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
            /* ── Step: Launch Success ─────────────────────── */
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
                {selectedTemplate
                  ? `Your ${selectedTemplate.agents.length}-agent team is starting up. Watch the dashboard as your company comes to life.`
                  : "Your CEO agent is starting up. Watch the dashboard as your company comes to life."}
              </p>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.5 }}
                className="mt-8"
              >
                <div className="flex items-center justify-center gap-2 text-[12px] text-[color:var(--muted)]">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[color:var(--success)]" />
                  {selectedTemplate ? "Team initializing..." : "CEO agent initializing..."}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
