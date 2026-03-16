import { useState } from "react";
import { motion } from "framer-motion";
import { Buildings, CheckCircle, FolderOpen, WarningCircle, XCircle } from "@phosphor-icons/react";
import type { ProfileSnapshot } from "@shared/types";
import { unwrap } from "../lib/desktop";
import { ActionButton, Input } from "./ui";

export function CompanyOnboarding({
  connectors,
  onDone,
}: {
  connectors: ProfileSnapshot["connectors"];
  onDone: () => Promise<void>;
}) {
  const [companyName, setCompanyName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasReadyConnector = connectors.some((c) => c.status === "ready" || c.status === "degraded");

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

  async function submit() {
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
      await onDone();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create the company.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-[100dvh] grid-cols-1 bg-[color:var(--bg)] md:grid-cols-[minmax(0,1fr)_440px]">
      <div className="flex items-center px-8 py-12 md:px-16">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-[420px]"
        >
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">AgentCompany Desktop</div>
          <h1 className="text-[38px] leading-[0.98] tracking-[-0.03em] text-[color:var(--text)] md:text-[48px]">
            Welcome.
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-[color:var(--muted)]">
            We detected the following coding agents on your system. You'll configure your organization structure, goals, and agents from the dashboard after setup.
          </p>
          <div className="mt-8">
            <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Detected connectors</div>
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

      <div className="flex items-center border-l border-[color:var(--line)] bg-[color:var(--bg-subtle)] px-6 py-10 md:px-10">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="surface w-full rounded-[12px] p-7"
        >
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Getting started</div>
          <div className="mb-1 text-[18px] font-semibold tracking-[-0.01em] text-[color:var(--text)]">Create your company</div>
          <div className="mb-6 h-px bg-[color:var(--line)]" />
          <div className="space-y-4">
            <Input label="Company name" value={companyName} onChange={setCompanyName} placeholder="e.g. Acme Engineering" />
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
                You can add more workspaces later from the dashboard.
              </div>
            </div>
          </div>
          {error ? (
            <div className="mt-5 rounded-[10px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-[color:var(--danger)]" role="alert">
              {error}
            </div>
          ) : null}
          <div className="mt-8 flex items-center justify-end gap-4">
            <ActionButton
              label={loading ? "Creating..." : "Continue to dashboard"}
              onClick={() => void submit()}
              icon={Buildings}
              tone="accent"
              loading={loading}
              disabled={!hasReadyConnector || !companyName.trim()}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
}
