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

export function VertexForm({ connectorId, onSaved }: Props) {
  const [project, setProject] = useState("");
  const [location, setLocation] = useState("");
  const [credentialsPath, setCredentialsPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const desktop = window.agentCompany;
    if (!desktop) return;
    if (project.trim().length === 0 || location.trim().length === 0) {
      setError("Project and location are required.");
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
      className={FORM_FIELDSET}
    >
      <div>
        <label className={FIELD_LABEL}>GCP project id</label>
        <input
          type="text"
          value={project}
          onChange={(event) => setProject(event.target.value)}
          disabled={busy}
          className={FIELD_INPUT}
          placeholder="my-gcp-project"
        />
      </div>
      <div>
        <label className={FIELD_LABEL}>Region / location</label>
        <input
          type="text"
          value={location}
          onChange={(event) => setLocation(event.target.value)}
          disabled={busy}
          className={FIELD_INPUT}
          placeholder="us-central1"
        />
      </div>
      <div>
        <label className={FIELD_LABEL}>Credentials JSON path (optional — leave blank for ADC)</label>
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            value={credentialsPath}
            onChange={(event) => setCredentialsPath(event.target.value)}
            disabled={busy}
            className={FIELD_INPUT}
            placeholder="/path/to/service-account.json"
          />
          <button
            type="button"
            onClick={() => void pickCredentialsFile()}
            disabled={busy}
            className={FORM_BUTTON_SECONDARY}
          >
            Browse
          </button>
        </div>
      </div>
      {error ? <div className={FORM_ERROR}>{error}</div> : null}
      <button type="submit" disabled={busy} className={FORM_BUTTON}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
