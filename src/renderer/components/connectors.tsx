import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, SignIn } from "@phosphor-icons/react";
import type { ConnectorRecord } from "@shared/types";
import { unwrap } from "../lib/desktop";
import { ActionButton, InlineNotice, Input, Select, StatusPill, TextArea } from "./ui";
import { useT } from "../i18n";

function getAuthActionCopy(connector: ConnectorRecord) {
  switch (connector.id) {
    case "codex_local":
      return {
        title: "Codex login required",
        message: "Codex is installed, but the CLI needs an authenticated session before AgentCompany can dispatch runs.",
        buttonLabel: "Open Terminal To Sign In",
      };
    case "claude_local":
      return {
        title: "Claude Code login required",
        message: "Claude Code is installed, but the local CLI is not authenticated for this desktop runtime.",
        buttonLabel: "Open Terminal To Sign In",
      };
    case "gemini_local":
      return {
        title: "Gemini authentication required",
        message: "Gemini CLI is available, but the runtime still needs an authenticated session. AgentCompany will open Gemini in a terminal and you can complete its interactive auth flow there.",
        buttonLabel: "Open Terminal",
      };
  }
}

export function ConnectorEditor({ connector, onSaved }: { connector: ConnectorRecord; onSaved: () => Promise<void> }) {
  const t = useT();
  const [model, setModel] = useState(connector.model ?? "");
  const [envBindingText, setEnvBindingText] = useState(connector.envBindingText);
  const [notes, setNotes] = useState(connector.notes);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openingAuthTerminal, setOpeningAuthTerminal] = useState(false);
  const [autoChecking, setAutoChecking] = useState(false);
  const [modelOptions, setModelOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [loadingModelOptions, setLoadingModelOptions] = useState(false);
  const [modelOptionsError, setModelOptionsError] = useState<string | null>(null);
  const authPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authActionCopy = getAuthActionCopy(connector);
  const needsLogin = connector.authState === "required" || connector.status === "auth_required";
  const requiresExplicitModel = false;
  const shouldLoadModelOptions = connector.capabilityMatrix.modelDiscovery;

  useEffect(() => {
    setModel(connector.model ?? "");
    setEnvBindingText(connector.envBindingText);
    setNotes(connector.notes);
    setSubmitError(null);
  }, [connector]);

  useEffect(() => () => {
    if (authPollTimeoutRef.current) {
      clearTimeout(authPollTimeoutRef.current);
      authPollTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!shouldLoadModelOptions) {
      setModelOptions([]);
      setModelOptionsError(null);
      setLoadingModelOptions(false);
      return;
    }
    setLoadingModelOptions(true);
    setModelOptionsError(null);
    void window.agentCompany.listConnectorModels(connector.id).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setModelOptions([]);
        setModelOptionsError(result.error.message);
        setLoadingModelOptions(false);
        return;
      }
      setModelOptions(result.data);
      setLoadingModelOptions(false);
    });
    return () => {
      cancelled = true;
    };
  }, [connector.id, shouldLoadModelOptions]);

  const modelSelectOptions = useMemo(() => {
    const options = [{ value: "", label: requiresExplicitModel ? "Please select a model..." : "Use connector default" }];
    const hasCurrentModel = modelOptions.some((option) => option.id === model);
    if (model && !hasCurrentModel) {
      options.push({ value: model, label: `${model} (saved)` });
    }
    options.push(...modelOptions.map((option) => ({ value: option.id, label: option.label || option.id })));
    return options;
  }, [model, modelOptions, requiresExplicitModel]);

  const runHealthCheck = useCallback(async (quiet = false) => {
    setAutoChecking(true);
    try {
      unwrap(await window.agentCompany.testConnector(connector.id));
      await onSaved();
      if (!quiet) {
        setSubmitError(null);
      }
      return true;
    } catch (error) {
      if (!quiet) {
        setSubmitError(error instanceof Error ? error.message : "Automatic connector health check failed.");
      }
      return false;
    } finally {
      setAutoChecking(false);
    }
  }, [connector.id, onSaved]);

  const scheduleAuthPolling = useCallback((remainingAttempts: number) => {
    if (authPollTimeoutRef.current) {
      clearTimeout(authPollTimeoutRef.current);
      authPollTimeoutRef.current = null;
    }
    if (remainingAttempts <= 0) {
      return;
    }
    authPollTimeoutRef.current = setTimeout(() => {
      void (async () => {
        const ok = await runHealthCheck(true);
        if (!ok) {
          scheduleAuthPolling(remainingAttempts - 1);
        }
      })();
    }, 5000);
  }, [runHealthCheck]);

  return (
    <div className="grid gap-4">
      {submitError ? <InlineNotice message={submitError} /> : null}
      {needsLogin ? (
        <div className="rounded-[8px] border border-[color:var(--warn)] bg-[color:var(--warn-soft)] px-4 py-4 text-[12px] text-[color:var(--warn)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em]">{authActionCopy.title}</div>
          <div className="mt-1.5 leading-relaxed">{authActionCopy.message}</div>
          <div className="mt-3">
            <ActionButton
              label={authActionCopy.buttonLabel}
              icon={SignIn}
              onClick={() => void (async () => {
                setOpeningAuthTerminal(true);
                setSubmitError(null);
                try {
                  unwrap(await window.agentCompany.openConnectorAuthTerminal(connector.id));
                  scheduleAuthPolling(12);
                } catch (error) {
                  setSubmitError(error instanceof Error ? error.message : "Could not open a terminal for connector login.");
                } finally {
                  setOpeningAuthTerminal(false);
                }
              })()}
              loading={openingAuthTerminal}
            />
          </div>
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-[color:var(--muted-strong)]">{t("conn.status")}</div>
          <div className="flex items-center gap-3">
            <StatusPill status={connector.status} />
            <span className="text-[12px] text-[color:var(--muted)]">{connector.version ?? "version unknown"}</span>
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-[color:var(--muted-strong)]">{t("conn.capabilityMatrix")}</div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(connector.capabilityMatrix).map(([key, value]) => (
              <div key={key} className={`rounded-[6px] border px-3 py-2 text-[12px] ${value ? "border-[color:var(--accent)] border-opacity-20 bg-[color:var(--accent-soft)] text-[color:var(--accent)]" : "border-[color:var(--line)] bg-[color:var(--panel-soft)] text-[color:var(--muted)]"}`}>
                {key}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div>
        <Input label="Command" value={connector.command} onChange={() => undefined} readOnly />
        <div className="mt-1.5 text-[12px] leading-relaxed text-[color:var(--muted)]">
          AgentCompany pins connector execution to the audited binary for this runtime. Command overrides are not accepted from the renderer.
        </div>
      </div>
      {shouldLoadModelOptions ? (
        <div className="grid gap-2">
          <Select
            label={requiresExplicitModel ? "Model (required)" : "Model"}
            value={model}
            onChange={setModel}
            options={modelSelectOptions}
          />
          {loadingModelOptions ? (
            <div className="text-[12px] text-[color:var(--muted)]">Loading available models...</div>
          ) : null}
          {modelOptionsError ? (
            <InlineNotice message={modelOptionsError} />
          ) : null}
          {requiresExplicitModel && !model.trim() ? (
            <div className="rounded-[8px] border border-[color:var(--warn)] bg-[color:var(--warn-soft)] px-4 py-3 text-[12px] text-[color:var(--warn)]">
              OpenCode is detected, but it still needs an explicit provider/model selection before AgentCompany can mark it ready.
            </div>
          ) : null}
        </div>
      ) : (
        <Input label="Model" value={model} onChange={setModel} placeholder="Connector default" />
      )}
      <TextArea label="Secret bindings" value={envBindingText} onChange={setEnvBindingText} rows={4} placeholder={"OPENAI_API_KEY=my-vault-key\nANTHROPIC_API_KEY=my-anthropic-key"} />
      <TextArea label="Operational notes" value={notes} onChange={setNotes} rows={4} />
      <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3 text-[12px] text-[color:var(--muted-strong)]">
        Connector health checks run automatically on app launch, after save, and after terminal login is opened.
        {autoChecking ? " Refreshing connector state..." : ""}
      </div>
      {connector.lastError ? (
        <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3 text-[12px] leading-relaxed text-[color:var(--muted-strong)]">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Latest health-check detail</div>
          <div>{connector.lastError}</div>
        </div>
      ) : null}
      <div className="flex gap-3">
        <ActionButton
          label={t("conn.saveConnector")}
          tone="accent"
          onClick={() => void (async () => {
            setSaving(true);
            setSubmitError(null);
            try {
              unwrap(await window.agentCompany.saveConnector({
                id: connector.id,
                command: connector.command,
                model: model || null,
                envBindingText,
                notes,
              }));
              await onSaved();
              await runHealthCheck(true);
            } catch (error) {
              setSubmitError(error instanceof Error ? error.message : "Connector could not be saved.");
            } finally {
              setSaving(false);
            }
          })()}
          icon={CheckCircle}
          loading={saving}
          disabled={requiresExplicitModel && !model.trim()}
        />
      </div>
      <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-4 text-[12px] leading-relaxed text-[color:var(--muted)]">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Configuration doc</div>
        <pre className="mono whitespace-pre-wrap">{connector.configurationDoc}</pre>
      </div>
    </div>
  );
}
