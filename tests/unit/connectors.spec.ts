import { describe, expect, it } from "vitest";
import { buildDefaultConnectorRows, parseEnvBindingText } from "../../src/main/connectors";

describe("parseEnvBindingText", () => {
  it("ignores comments and blank lines while preserving values with equals", () => {
    expect(
      parseEnvBindingText(`
        # comment
        OPENAI_API_KEY=vault-openai

        CUSTOM=value=with=equals
      `),
    ).toEqual({
      OPENAI_API_KEY: "vault-openai",
      CUSTOM: "value=with=equals",
    });
  });
});

describe("buildDefaultConnectorRows", () => {
  it("preserves previously saved connector commands", () => {
    const [codex] = buildDefaultConnectorRows([
      {
        id: "codex_local",
        command: "/usr/local/bin/codex",
        status: "ready",
        notes: "custom note",
      },
    ]);

    expect(codex.id).toBe("codex_local");
    expect(codex.command).toBe("/usr/local/bin/codex");
    expect(codex.status).toBe("ready");
    expect(codex.notes).toBe("custom note");
    expect(codex.capabilityMatrix.structuredTranscript).toBe(true);
  });
});
