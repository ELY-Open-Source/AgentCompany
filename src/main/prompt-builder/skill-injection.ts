import type { ConnectorId } from "@shared/types";
import { getConnectorStrengths } from "../connector-matching";

interface ConnectorSectionCtx {
  allConnectors: Array<{ id: string; label: string; status: string; enabledModels?: string[] }>;
}

export function buildConnectorSection(ctx: ConnectorSectionCtx): string | null {
  if (!ctx.allConnectors || ctx.allConnectors.length === 0) return null;

  const usableConnectors = ctx.allConnectors.filter(
    (connector) => connector.status === "ready" && (connector.enabledModels?.length ?? 0) > 0,
  );
  if (usableConnectors.length === 0) return null;

  const connectorLines = usableConnectors.map((c) => {
    const strengths = getConnectorStrengths(c.id as ConnectorId);
    return `- **${c.label}** (\`${c.id}\`): ${strengths} [STATUS: ${c.status}]. Enabled models: ${c.enabledModels?.join(", ")}.`;
  });

  return `# Available Connectors
${connectorLines.join("\n")}

When creating agents, automatically assign the best ready connector for their role. Use connectors marked "ready" only, and choose from the enabled model pool shown for each connector.
`;
}
