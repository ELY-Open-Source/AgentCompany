import { useState } from "react";
import { ActionButton, Input } from "../../ui";
import { useT } from "../../../i18n";

interface Props {
  connectorId: string;
  onSaved?: () => void;
}

interface DeploymentEntry {
  modelId: string;
  deploymentName: string;
}

export function AzureForm({ connectorId, onSaved }: Props) {
  const t = useT();
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
      setError(t("form.azure.errApiKeyRequired"));
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
      className="space-y-3"
    >
      <Input label={t("form.azure.apiKey")} type="password" value={apiKey} onChange={setApiKey} disabled={busy} />
      <Input label={t("form.azure.baseUrl")} type="url" value={baseUrl} onChange={setBaseUrl} disabled={busy} placeholder="https://YOUR-RESOURCE.openai.azure.com/" />
      <Input label={t("form.azure.resourceName")} value={resourceName} onChange={setResourceName} disabled={busy} />
      <Input label={t("form.azure.apiVersion")} value={apiVersion} onChange={setApiVersion} disabled={busy} placeholder="2024-08-01-preview" />
      <fieldset className="rounded-md border border-border/50 px-3 py-2">
        <legend className="px-1 text-[11px] font-medium text-muted-foreground">
          {t("form.azure.deploymentMap")}
        </legend>
        <div className="space-y-2">
          {deployments.map((entry, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="flex-1">
                <Input
                  value={entry.modelId}
                  placeholder="gpt-4o"
                  disabled={busy}
                  onChange={(newVal) =>
                    setDeployments((prev) =>
                      prev.map((p, i) => (i === index ? { ...p, modelId: newVal } : p)),
                    )
                  }
                />
              </div>
              <div className="flex-1">
                <Input
                  value={entry.deploymentName}
                  placeholder="my-gpt4-deployment"
                  disabled={busy}
                  onChange={(newVal) =>
                    setDeployments((prev) =>
                      prev.map((p, i) =>
                        i === index ? { ...p, deploymentName: newVal } : p,
                      ),
                    )
                  }
                />
              </div>
              <ActionButton
                label={t("form.azure.remove")}
                disabled={busy}
                onClick={() => setDeployments((prev) => prev.filter((_, i) => i !== index))}
              />
            </div>
          ))}
          <ActionButton
            label={t("form.azure.addMapping")}
            disabled={busy}
            onClick={() => setDeployments((prev) => [...prev, { modelId: "", deploymentName: "" }])}
          />
        </div>
      </fieldset>
      {error ? (
        <div role="alert" className="rounded-md border border-[color:var(--destructive)] bg-destructive-muted px-3 py-2 text-[11px] text-destructive">
          {error}
        </div>
      ) : null}
      <ActionButton
        type="submit"
        label={busy ? t("form.saving") : t("form.save")}
        tone="accent"
        disabled={busy}
        loading={busy}
      />
    </form>
  );
}
