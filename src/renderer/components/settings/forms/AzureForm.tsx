import { useState } from "react";
import {
  FIELD_INPUT,
  FIELD_LABEL,
  FORM_BUTTON,
  FORM_BUTTON_SECONDARY,
  FORM_ERROR,
  FORM_FIELDSET,
} from "./form-shared";

interface Props {
  connectorId: string;
  onSaved?: () => void;
}

interface DeploymentEntry {
  modelId: string;
  deploymentName: string;
}

export function AzureForm({ connectorId, onSaved }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [resourceName, setResourceName] = useState("");
  const [apiVersion, setApiVersion] = useState("");
  const [deployments, setDeployments] = useState<DeploymentEntry[]>([
    { modelId: "", deploymentName: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const desktop = window.agentCompany;
    if (!desktop) return;
    if (apiKey.trim().length === 0) {
      setError("API key required.");
      return;
    }
    setBusy(true);
    setError(null);
    const deploymentMap = Object.fromEntries(
      deployments
        .map((entry) => [entry.modelId.trim(), entry.deploymentName.trim()])
        .filter(([k, v]) => k.length > 0 && v.length > 0),
    );
    const result = await desktop.saveCredential({
      connectorId,
      payload: {
        kind: "azure",
        value: {
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim() || undefined,
          resourceName: resourceName.trim() || undefined,
          apiVersion: apiVersion.trim() || undefined,
          deploymentMap: Object.keys(deploymentMap).length > 0 ? deploymentMap : undefined,
        },
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onSaved?.();
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
      className={FORM_FIELDSET}
    >
      <div>
        <label className={FIELD_LABEL}>API key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          disabled={busy}
          className={FIELD_INPUT}
          autoComplete="off"
        />
      </div>
      <div>
        <label className={FIELD_LABEL}>Base URL (optional)</label>
        <input
          type="url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          disabled={busy}
          className={FIELD_INPUT}
          placeholder="https://YOUR-RESOURCE.openai.azure.com/"
        />
      </div>
      <div>
        <label className={FIELD_LABEL}>Resource name (optional)</label>
        <input
          type="text"
          value={resourceName}
          onChange={(event) => setResourceName(event.target.value)}
          disabled={busy}
          className={FIELD_INPUT}
        />
      </div>
      <div>
        <label className={FIELD_LABEL}>API version (optional)</label>
        <input
          type="text"
          value={apiVersion}
          onChange={(event) => setApiVersion(event.target.value)}
          disabled={busy}
          className={FIELD_INPUT}
          placeholder="2024-08-01-preview"
        />
      </div>
      <fieldset className="rounded-md border border-border/50 px-3 py-2">
        <legend className="px-1 text-[11px] font-medium text-muted-foreground">
          Deployment map (model id → deployment name)
        </legend>
        <div className="space-y-2">
          {deployments.map((entry, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={entry.modelId}
                placeholder="gpt-4o"
                disabled={busy}
                className={FIELD_INPUT}
                onChange={(event) =>
                  setDeployments((prev) =>
                    prev.map((p, i) => (i === index ? { ...p, modelId: event.target.value } : p)),
                  )
                }
              />
              <input
                type="text"
                value={entry.deploymentName}
                placeholder="my-gpt4-deployment"
                disabled={busy}
                className={FIELD_INPUT}
                onChange={(event) =>
                  setDeployments((prev) =>
                    prev.map((p, i) =>
                      i === index ? { ...p, deploymentName: event.target.value } : p,
                    ),
                  )
                }
              />
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setDeployments((prev) => prev.filter((_, i) => i !== index))
                }
                className={FORM_BUTTON_SECONDARY}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              setDeployments((prev) => [...prev, { modelId: "", deploymentName: "" }])
            }
            className={FORM_BUTTON_SECONDARY}
          >
            Add mapping
          </button>
        </div>
      </fieldset>
      {error ? <div className={FORM_ERROR}>{error}</div> : null}
      <button type="submit" disabled={busy} className={FORM_BUTTON}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
