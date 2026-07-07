import { useMemo, useState, type FormEvent } from "react";
import { Button } from "../../shared/ui";
import type { SnapshotActions } from "../../app/useSnapshot";
import type { ComposioSettingRecord } from "../../../../shared/snapshot-domain";

function hasSavedKey(settings: ComposioSettingRecord[], orgId: string): boolean {
  return settings.some((s) => s.orgId === orgId && s.key === "api_key" && s.value.length > 0);
}

/**
 * The Composio project API key. Which toolkits agents may use is decided by
 * connections and per-agent grants on the Connectors page, not here.
 */
export function ComposioPanel({
  orgId,
  settings,
  actions,
}: {
  orgId: string;
  settings: ComposioSettingRecord[];
  actions: SnapshotActions;
}) {
  const keyConfigured = useMemo(() => hasSavedKey(settings, orgId), [settings, orgId]);
  const [apiKey, setApiKey] = useState("");

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    const key = apiKey.trim();
    if (!key) return;
    void actions.run(() => window.agentCompany.saveComposioSettings({
      orgId,
      apiKey: key,
      toolkits: [],
    })).then(() => setApiKey(""));
  };

  return (
    <form onSubmit={handleSave} className="row" style={{ gap: 8, maxWidth: 480 }}>
      <input
        type="password"
        className="input"
        aria-label="Composio API key"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        placeholder={keyConfigured ? "••••••••" : "ak_..."}
        autoComplete="off"
        style={{ flex: 1 }}
      />
      <Button tone="primary" type="submit" disabled={!apiKey.trim()}>Save</Button>
    </form>
  );
}
