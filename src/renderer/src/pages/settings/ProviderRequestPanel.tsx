import { useState, type FormEvent } from "react";
import type { ProviderCatalogEntry, ProviderRecord, ProviderRequestRecord, WorkspaceRecord } from "../../../../shared/domain";
import { PROVIDER_DATA_POLICY, PROVIDER_EXECUTION_MODE, PROVIDER_REQUEST_STATE, type ProviderExecutionMode } from "../../../../shared/domain";
import type { SnapshotActions } from "../../app/useSnapshot";
import { Button, Field, Icon, Pill, Segmented } from "../../shared/ui";
import { t } from "../../i18n/i18n";

interface ProviderRequestPanelProps {
  orgId: string;
  providers: ProviderRecord[];
  catalog: ProviderCatalogEntry[];
  workspaces: WorkspaceRecord[];
  providerRequests: ProviderRequestRecord[];
  actions: SnapshotActions;
}

const MODE_OPTIONS: ReadonlyArray<{ id: ProviderExecutionMode; label: string }> = [
  { id: PROVIDER_EXECUTION_MODE.FOREGROUND, label: t("Foreground") },
  { id: PROVIDER_EXECUTION_MODE.BACKGROUND, label: t("Background") },
];

const ACTIVE_REQUEST_STATES = new Set<string>([
  PROVIDER_REQUEST_STATE.PENDING,
  PROVIDER_REQUEST_STATE.STREAMING,
]);

export function ProviderRequestPanel({
  orgId,
  providers,
  catalog,
  workspaces,
  providerRequests,
  actions,
}: ProviderRequestPanelProps) {
  const executableProviders = providers.filter((provider) => provider.enabled && provider.authType === "api_key");
  const [providerId, setProviderId] = useState(executableProviders[0]?.id ?? "");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [mode, setMode] = useState<ProviderExecutionMode>(PROVIDER_EXECUTION_MODE.FOREGROUND);
  const selectedProvider = resolveSelectedProvider(executableProviders, providerId);
  const canRunBackground = selectedProvider ? isBackgroundReady(selectedProvider, catalog) : false;
  const selectedMode = canRunBackground ? mode : PROVIDER_EXECUTION_MODE.FOREGROUND;
  const effectiveWorkspaceId = selectedWorkspaceValue(workspaces, workspaceId);
  const recentRequests = providerRequests
    .filter((request) => executableProviders.some((provider) => provider.id === request.providerId))
    .slice(0, 8);

  if (executableProviders.length === 0) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const prompt = String(form.get("prompt") ?? "").trim();
    if (!prompt) throw new Error("Prompt is required.");
    const instructions = String(form.get("instructions") ?? "").trim();
    const formElement = event.currentTarget;
    void actions.run(() => window.agentCompany.createProviderResponse({
      orgId,
      providerId: requireProviderId(selectedProvider),
      workspaceId: selectedWorkspaceId(workspaces, effectiveWorkspaceId),
      prompt,
      instructions: instructions || null,
      executionMode: selectedMode,
    })).then((result) => { if (result) formElement.reset(); });
  };

  return (
    <>
      <div className="section-label" style={{ marginBottom: 10 }}>{t("Requests")}</div>
      <form className="card" style={{ marginBottom: 10 }} onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 1fr) minmax(150px, 1fr) minmax(200px, 1fr) auto", gap: 10, alignItems: "end" }}>
          <Field label={t("Provider")}>
            <select
              className="input"
              aria-label={t("Request provider")}
              value={selectedProvider?.id ?? ""}
              onChange={(event) => setProviderId(event.target.value)}
            >
              {executableProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.label}</option>
              ))}
            </select>
          </Field>
          <Field label={t("Workspace")}>
            <select
              className="input"
              aria-label={t("Request workspace")}
              value={effectiveWorkspaceId}
              disabled={workspaces.length === 0}
              onChange={(event) => setWorkspaceId(event.target.value)}
            >
              {workspaces.length === 0 && <option value="">{t("Organization")}</option>}
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </select>
          </Field>
          <div className="field">
            <span>{t("Mode")}</span>
            <div style={{ alignSelf: "flex-start" }}>
              <Segmented
                value={selectedMode}
                onChange={setMode}
                options={backgroundAwareOptions(canRunBackground)}
              />
            </div>
          </div>
          <Button type="submit" tone="primary">
            <span className="row" style={{ gap: 6 }}>
              <Icon name="send" size={16} />
              {t("Run")}
            </span>
          </Button>
        </div>
        <Field label={t("Prompt")}>
          <textarea className="input" aria-label={t("Request prompt")} name="prompt" required rows={3} style={{ resize: "vertical" }} />
        </Field>
        <Field label={t("Instructions")}>
          <input className="input" aria-label={t("Request instructions")} name="instructions" />
        </Field>
      </form>
      {recentRequests.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 28 }}>
          <div className="table-row head" style={{ gridTemplateColumns: "minmax(120px, 1fr) minmax(120px, 1fr) 92px 100px minmax(120px, 1fr) 86px", minWidth: 760 }}>
            <div>{t("Provider")}</div><div>{t("Workspace")}</div><div>{t("Mode")}</div><div>{t("State")}</div><div>{t("Output")}</div><div>{t("Action")}</div>
          </div>
          {recentRequests.map((request, index) => (
            <ProviderRequestRow
              key={request.id}
              orgId={orgId}
              request={request}
              provider={requireRequestProvider(providers, request)}
              workspace={resolveRequestWorkspace(workspaces, request)}
              last={index === recentRequests.length - 1}
              actions={actions}
            />
          ))}
        </div>
      )}
    </>
  );
}

function ProviderRequestRow({
  orgId,
  request,
  provider,
  workspace,
  last,
  actions,
}: {
  orgId: string;
  request: ProviderRequestRecord;
  provider: ProviderRecord;
  workspace: WorkspaceRecord | null;
  last: boolean;
  actions: SnapshotActions;
}) {
  const canCancel = ACTIVE_REQUEST_STATES.has(request.state) && Boolean(request.externalResponseId);
  const cancel = () => {
    void actions.run(() => window.agentCompany.cancelProviderResponse({ orgId, requestId: request.id }));
  };
  return (
    <div
      className="table-row"
      style={{
        gridTemplateColumns: "minmax(120px, 1fr) minmax(120px, 1fr) 92px 100px minmax(120px, 1fr) 86px",
        minWidth: 760,
        borderBottom: last ? "none" : "1px solid var(--border-soft)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{provider.label}</div>
        <div className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{request.model}</div>
      </div>
      <div className="mono" style={{ color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{workspace?.name ?? t("Organization")}</div>
      <div className="mono" style={{ color: "var(--text-2)" }}>{request.executionMode}</div>
      <div><Pill tone={stateTone(request.state)}>{request.state}</Pill></div>
      <div className="mono" style={{ color: "var(--text-2)" }}>{t("{count} chars", { count: request.outputCharCount })}</div>
      <Button size="small" tone="ghost" onClick={cancel} disabled={!canCancel}>
        <span className="row" style={{ gap: 5 }}>
          <Icon name="x" size={12} />
          {t("Cancel")}
        </span>
      </Button>
    </div>
  );
}

function backgroundAwareOptions(canRunBackground: boolean): ReadonlyArray<{ id: ProviderExecutionMode; label: string }> {
  return canRunBackground ? MODE_OPTIONS : [MODE_OPTIONS[0]];
}

function isBackgroundReady(provider: ProviderRecord, catalog: ProviderCatalogEntry[]): boolean {
  const entry = catalog.find((item) => item.key === provider.providerKey);
  if (!entry) throw new Error(`Provider catalog entry missing for ${provider.providerKey}.`);
  return entry.capabilityTags.includes("background")
    && provider.backgroundEnabled
    && provider.dataPolicy === PROVIDER_DATA_POLICY.STANDARD;
}

function resolveSelectedProvider(providers: ProviderRecord[], providerId: string): ProviderRecord | null {
  if (providers.length === 0) return null;
  const provider = providers.find((item) => item.id === providerId);
  return provider ?? providers[0] ?? null;
}

function selectedWorkspaceId(workspaces: WorkspaceRecord[], workspaceId: string): string | null {
  return workspaces.some((workspace) => workspace.id === workspaceId) ? workspaceId : null;
}

function selectedWorkspaceValue(workspaces: WorkspaceRecord[], workspaceId: string): string {
  if (workspaces.some((workspace) => workspace.id === workspaceId)) return workspaceId;
  return workspaces[0]?.id ?? "";
}

function resolveRequestWorkspace(workspaces: WorkspaceRecord[], request: ProviderRequestRecord): WorkspaceRecord | null {
  if (!request.workspaceId) return null;
  return workspaces.find((workspace) => workspace.id === request.workspaceId) ?? null;
}

function requireProviderId(provider: ProviderRecord | null): string {
  if (!provider) throw new Error("Provider is required.");
  return provider.id;
}

function requireRequestProvider(providers: ProviderRecord[], request: ProviderRequestRecord): ProviderRecord {
  const provider = providers.find((item) => item.id === request.providerId);
  if (!provider) throw new Error(`Provider missing for request ${request.id}.`);
  return provider;
}

function stateTone(state: ProviderRequestRecord["state"]): "amber" | "green" | "violet" | "red" | undefined {
  if (state === PROVIDER_REQUEST_STATE.PENDING) return "amber";
  if (state === PROVIDER_REQUEST_STATE.STREAMING) return "violet";
  if (state === PROVIDER_REQUEST_STATE.SUCCEEDED) return "green";
  if (state === PROVIDER_REQUEST_STATE.FAILED) return "red";
  return undefined;
}
