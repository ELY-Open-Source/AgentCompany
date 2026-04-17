import { useState } from "react";
import { ActionButton, Input } from "../../ui";
import { useT } from "../../../i18n";

const desktop = (typeof window !== "undefined" ? window.agentCompany : null) as
  | (Window["agentCompany"] | null);

interface Props {
  connectorId: string;
  defaultEnvVar?: string;
  onSaved?: () => void;
}

export function ApiKeyForm({ connectorId, defaultEnvVar, onSaved }: Props) {
  const t = useT();
  const [source, setSource] = useState<"literal" | "env">("literal");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEnv = source === "env";
  const canSave = value.trim().length > 0 && !busy && Boolean(desktop);

  const handleSubmit = async () => {
    if (!desktop || !canSave) return;
    setBusy(true);
    setError(null);
    const result = await desktop.saveCredential({
      connectorId,
      payload: {
        kind: "api_key",
        value: { source, value: value.trim() },
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setValue("");
    onSaved?.();
  };

  const toggleSource = () => {
    setSource(isEnv ? "literal" : "env");
    setValue("");
    setError(null);
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
        type={isEnv ? "text" : "password"}
        value={value}
        onChange={setValue}
        placeholder={isEnv ? (defaultEnvVar ?? t("form.envVarPlaceholder")) : t("form.apiKeyPlaceholder")}
        disabled={busy}
        ariaLabel={isEnv ? t("form.envVarAriaLabel") : t("form.apiKeyAriaLabel")}
      />

      {error ? (
        <div role="alert" className="text-[11px] text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={toggleSource}
          disabled={busy}
          className="text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        >
          {isEnv ? t("form.pasteKey") : t("form.useEnvVar")}
        </button>
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
