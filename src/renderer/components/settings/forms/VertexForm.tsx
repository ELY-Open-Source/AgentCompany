import { useState } from "react";
import { ActionButton, Input } from "../../ui";
import { useT } from "../../../i18n";

interface Props {
  connectorId: string;
  onSaved?: () => void;
}

export function VertexForm({ connectorId, onSaved }: Props) {
  const t = useT();
  const [project, setProject] = useState("");
  const [location, setLocation] = useState("");
  const [credentialsPath, setCredentialsPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const desktop = window.agentCompany;
    if (!desktop) return;
    if (project.trim().length === 0 || location.trim().length === 0) {
      setError(t("form.vertex.errProjectLocationRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await desktop.saveCredential({
      connectorId,
      payload: {
        kind: "gcp_adc",
        value: {
          project: project.trim(),
          location: location.trim(),
          credentialsPath: credentialsPath.trim() || undefined,
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

  const pickCredentialsFile = async () => {
    const desktop = window.agentCompany;
    if (!desktop) return;
    const result = await desktop.pickDirectory();
    if (result.ok && result.data) setCredentialsPath(result.data);
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
      className="space-y-3"
    >
      <Input label={t("form.vertex.project")} value={project} onChange={setProject} disabled={busy} placeholder="my-gcp-project" />
      <Input label={t("form.vertex.location")} value={location} onChange={setLocation} disabled={busy} placeholder="us-central1" />
      <div>
        <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">{t("form.vertex.credentialsPath")}</div>
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              value={credentialsPath}
              onChange={setCredentialsPath}
              disabled={busy}
              placeholder="/path/to/service-account.json"
            />
          </div>
          <ActionButton label={t("form.vertex.browse")} disabled={busy} onClick={() => void pickCredentialsFile()} />
        </div>
      </div>
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
