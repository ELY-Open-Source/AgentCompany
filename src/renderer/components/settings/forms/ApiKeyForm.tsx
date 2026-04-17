import { useState } from "react";

const desktop = (typeof window !== "undefined" ? window.agentCompany : null) as
  | (Window["agentCompany"] | null);

interface Props {
  connectorId: string;
  defaultEnvVar?: string;
  onSaved?: () => void;
}

export function ApiKeyForm({ connectorId, defaultEnvVar, onSaved }: Props) {
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
      <input
        type={isEnv ? "text" : "password"}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={isEnv ? (defaultEnvVar ?? "PROVIDER_API_KEY") : "Paste your API key"}
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
        autoFocus
        aria-label={isEnv ? "Environment variable name" : "API key"}
        className="block w-full rounded-md border border-border bg-background px-3 py-2.5 font-mono text-[12px] tracking-tight text-foreground outline-none transition-colors placeholder:font-sans placeholder:tracking-normal placeholder:text-muted-foreground/50 focus:border-foreground/50 disabled:opacity-50"
      />

      {error ? (
        <div role="alert" className="text-[11px] text-red-400">
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
          {isEnv ? "Paste key directly" : "Use environment variable instead"}
        </button>
        <button
          type="submit"
          disabled={!canSave}
          className="rounded px-3 py-1.5 text-[11px] font-medium bg-foreground text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
