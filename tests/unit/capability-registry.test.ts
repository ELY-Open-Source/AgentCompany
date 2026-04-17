import { describe, expect, it } from "vitest";
import { buildCapabilityRegistrySection } from "@main/prompt-builder/capability-registry";

describe("buildCapabilityRegistrySection", () => {
  it("renders a company-wide capability summary for delegation decisions", () => {
    const section = buildCapabilityRegistrySection({
      companySkillCatalog: [
        { name: "React Standards", slug: "react-standards", description: "Use when building React UI" },
      ],
      companyWorkspaces: [
        { name: "Primary", localPath: "/tmp/workspace" },
      ],
      allConnectors: [
        { id: "openai-codex", label: "Codex", status: "ready", enabledModels: ["gpt-5.4"] },
      ],
      companyDocuments: [
        {
          id: "doc-1",
          companyId: "company-1",
          title: "Architecture Decision",
          type: "architecture_decision",
          content: "",
          status: "approved",
          authorAgentId: null,
          reviewerAgentId: null,
          projectId: null,
          goalId: null,
          parentDocId: null,
          version: 1,
          tagsJson: "[]",
          latestRevisionId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    expect(section).toContain("# Company Capability Registry");
    expect(section).toContain("React Standards (`react-standards`)");
    expect(section).toContain("Primary: /tmp/workspace");
    expect(section).toContain("Codex (`openai-codex`) — models: gpt-5.4");
    expect(section).toContain("architecture_decision");
  });
});
