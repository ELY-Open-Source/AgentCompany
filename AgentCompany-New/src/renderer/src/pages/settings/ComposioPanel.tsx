import { useMemo, useState, type FormEvent } from "react";
import { Button } from "../../shared/ui";
import type { SnapshotActions } from "../../app/useSnapshot";
import type { ComposioSettingRecord } from "../../../../shared/snapshot-domain";

const AVAILABLE_TOOLKITS = [
  { id: "github", label: "GitHub" },
  { id: "gmail", label: "Gmail" },
  { id: "slack", label: "Slack" },
  { id: "notion", label: "Notion" },
  { id: "linear", label: "Linear" },
  { id: "jira", label: "Jira" },
  { id: "google_calendar", label: "Google Calendar" },
  { id: "google_drive", label: "Google Drive" },
  { id: "google_docs", label: "Google Docs" },
  { id: "google_sheets", label: "Google Sheets" },
  { id: "trello", label: "Trello" },
  { id: "asana", label: "Asana" },
  { id: "discord", label: "Discord" },
  { id: "twitter", label: "Twitter / X" },
  { id: "youtube", label: "YouTube" },
  { id: "hubspot", label: "HubSpot" },
  { id: "salesforce", label: "Salesforce" },
  { id: "zendesk", label: "Zendesk" },
  { id: "figma", label: "Figma" },
  { id: "airtable", label: "Airtable" },
];

function parseSavedToolkits(settings: ComposioSettingRecord[], orgId: string): Set<string> {
  const row = settings.find((s) => s.orgId === orgId && s.key === "toolkits");
  if (!row?.value) return new Set();
  try {
    const parsed = JSON.parse(row.value);
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function hasSavedKey(settings: ComposioSettingRecord[], orgId: string): boolean {
  return settings.some((s) => s.orgId === orgId && s.key === "api_key" && s.value.length > 0);
}

export function ComposioPanel({
  orgId,
  settings,
  actions,
}: {
  orgId: string;
  settings: ComposioSettingRecord[];
  actions: SnapshotActions;
}) {
  const savedToolkits = useMemo(() => parseSavedToolkits(settings, orgId), [settings, orgId]);
  const keyConfigured = useMemo(() => hasSavedKey(settings, orgId), [settings, orgId]);

  const [apiKey, setApiKey] = useState("");
  const [selected, setSelected] = useState<Set<string>>(savedToolkits);
  const [saved, setSaved] = useState(false);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const key = apiKey.trim();
    if (!key && !keyConfigured) return;
    const row = settings.find((s) => s.orgId === orgId && s.key === "api_key");
    const effectiveKey = key || row?.value || "";
    if (!effectiveKey) return;
    await actions.run(() => window.agentCompany.saveComposioSettings({
      orgId,
      apiKey: effectiveKey,
      toolkits: [...selected],
    }));
    setApiKey("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>External Tools</h2>
      <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 24 }}>
        Connect your agents to external services via Composio.
      </p>
      <form onSubmit={handleSave}>
        <label style={{ display: "block", marginBottom: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 6 }}>API Key</span>
          <input
            type="password"
            className="input"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={keyConfigured ? "••••••••" : undefined}
            autoComplete="off"
            style={{ width: "100%", maxWidth: 400 }}
          />
        </label>
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 8 }}>Toolkits</span>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 6,
          }}>
            {AVAILABLE_TOOLKITS.map((toolkit) => (
              <label
                key={toolkit.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 13,
                  background: selected.has(toolkit.id) ? "var(--accent-soft)" : "transparent",
                  transition: "background 0.12s",
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(toolkit.id)}
                  onChange={() => toggle(toolkit.id)}
                  style={{ accentColor: "var(--accent)" }}
                />
                {toolkit.label}
              </label>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Button tone="primary" type="submit" disabled={!apiKey.trim() && !keyConfigured}>
            Save
          </Button>
          {saved && <span style={{ fontSize: 13, color: "var(--green)" }}>Saved</span>}
        </div>
      </form>
    </div>
  );
}
