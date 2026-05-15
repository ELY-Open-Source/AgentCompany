import { useState } from "react";
import { isLocalConnectorBaseUrl } from "@shared/contracts/schemas-credentials";
import { ActionButton, Input } from "../../ui";
import { useT } from "../../../i18n";

const desktop = (typeof window !== "undefined" ? window.agentCompany : null) as
  | (Window["agentCompany"] | null);

interface Props {
  connectorId: string;
  defaultBaseUrl: string;
  onSaved?: () => void;
}

export function LocalForm({ connectorId, defaultBaseUrl, onSaved }: Props) {
  const t = useT();
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = baseUrl.trim();
  const canSave = trimmed.length > 0 && !busy && Boolean(desktop);

  const handleSubmit = async () => {
    if (!desktop || !canSave) return;
    if (!isLocalConnectorBaseUrl(trimmed)) {
      setError(t("onboarding.providers.baseUrlInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await desktop.saveCredential({
      connectorId,
      payload: { kind: "local", value: { baseUrl: trimmed } },
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
      <Input
        type="text"
        value={baseUrl}
        onChange={setBaseUrl}
        placeholder={defaultBaseUrl}
        disabled={busy}
        ariaLabel={t("onboarding.providers.baseUrlLabel")}
      />

      {error ? (
        <div role="alert" className="text-[11px] text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <ActionButton
          type="submit"
          label={busy ? t("form.saving") : t("form.save")}
          tone="accent"
          disabled={!canSave}
          loading={busy}
        />
      </div>
    </form>
  );
}
