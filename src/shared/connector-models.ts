export interface ConnectorModelEntry {
  id: string;
  label: string;
  enabled: boolean;
}

function dedupeById(entries: Array<{ id: string; label: string; enabled: boolean }>) {
  const seen = new Map<string, ConnectorModelEntry>();
  for (const entry of entries) {
    if (!entry.id.trim()) continue;
    const existing = seen.get(entry.id);
    if (!existing) {
      seen.set(entry.id, { ...entry, id: entry.id.trim() });
      continue;
    }
    seen.set(entry.id, {
      ...existing,
      label: existing.label || entry.label,
      enabled: existing.enabled || entry.enabled,
    });
  }
  return Array.from(seen.values());
}

export function mergeConnectorModelEntries(
  enabledModels: Array<{ id: string; label: string }>,
  disabledModels: Array<{ id: string; label: string }>,
): ConnectorModelEntry[] {
  return dedupeById([
    ...enabledModels.map((entry) => ({ ...entry, enabled: true })),
    ...disabledModels.map((entry) => ({ ...entry, enabled: false })),
  ]).sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

