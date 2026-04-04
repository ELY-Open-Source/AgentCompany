import type { PromptContext } from "./index";

export function buildCapabilityRegistrySection(ctx: Pick<PromptContext,
  "companySkillCatalog" | "companyWorkspaces" | "allConnectors" | "companyDocuments"
>): string | null {
  const parts: string[] = [];

  if (ctx.companySkillCatalog && ctx.companySkillCatalog.length > 0) {
    const skills = ctx.companySkillCatalog
      .slice(0, 12)
      .map((skill) => `- ${skill.name} (\`${skill.slug}\`)${skill.description ? ` — ${skill.description}` : ""}`);
    parts.push(`## Skill Catalog\n${skills.join("\n")}`);
  }

  if (ctx.companyWorkspaces && ctx.companyWorkspaces.length > 0) {
    const workspaces = ctx.companyWorkspaces
      .slice(0, 6)
      .map((workspace) => `- ${workspace.name}: ${workspace.localPath}`);
    parts.push(`## Workspaces\n${workspaces.join("\n")}`);
  }

  if (ctx.companyDocuments && ctx.companyDocuments.length > 0) {
    const documentTypes = Array.from(new Set(ctx.companyDocuments.map((document) => document.type))).sort();
    parts.push(`## Document Types\n- ${documentTypes.join(", ")}`);
  }

  if (ctx.allConnectors && ctx.allConnectors.length > 0) {
    const connectors = ctx.allConnectors
      .filter((connector) => connector.status === "ready")
      .slice(0, 8)
      .map((connector) => `- ${connector.label} (\`${connector.id}\`)${connector.enabledModels?.length ? ` — models: ${connector.enabledModels.join(", ")}` : ""}`);
    if (connectors.length > 0) {
      parts.push(`## Ready Connectors\n${connectors.join("\n")}`);
    }
  }

  if (parts.length === 0) {
    return null;
  }

  return `# Company Capability Registry\n${parts.join("\n\n")}\n`;
}
