import { describe, expect, it } from "vitest";

// The worker runs in a utility process so we can't import it directly.
// Instead, we duplicate the pure utility functions here to test their logic.

const ENV_ALLOWLIST: ReadonlySet<string> = new Set([
  "PATH", "HOME", "USER", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR",
  "DEVELOPER_DIR", "SDKROOT", "NODE_ENV", "NODE_OPTIONS",
  "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL",
  "GIT_SSH_COMMAND", "GIT_ASKPASS", "GIT_TERMINAL_PROMPT",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR",
  "DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS",
  "APPDATA", "LOCALAPPDATA", "USERPROFILE", "SYSTEMROOT", "COMSPEC", "PROGRAMFILES",
  "AGENT_COMPANY_API_URL", "AGENT_COMPANY_API_KEY", "AGENT_COMPANY_RUN_ID",
]);

function buildSanitizedEnv(
  hostEnv: Record<string, string>,
  secretBindings: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    if (key in hostEnv) {
      result[key] = hostEnv[key];
    }
  }
  Object.assign(result, secretBindings);
  return result;
}

function buildRedactor(env: Record<string, string>): (text: string) => string {
  const sensitivePatterns: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value.length < 8) continue;
    if (["PATH", "HOME", "USER", "SHELL", "LANG", "TMPDIR", "TERM"].includes(key)) continue;
    sensitivePatterns.push(value);
  }
  if (sensitivePatterns.length === 0) return (text) => text;
  sensitivePatterns.sort((a, b) => b.length - a.length);
  return (text: string) => {
    let result = text;
    for (const pattern of sensitivePatterns) {
      if (result.includes(pattern)) {
        result = result.replaceAll(pattern, "[REDACTED]");
      }
    }
    return result;
  };
}

describe("buildSanitizedEnv", () => {
  it("only includes allowlisted env vars from host", () => {
    const result = buildSanitizedEnv(
      {
        PATH: "/usr/bin",
        HOME: "/home/user",
        OPENAI_API_KEY: "sk-secret-12345",
        AWS_SECRET_ACCESS_KEY: "aws-secret-key",
        RANDOM_ENV: "should-not-appear",
      },
      {},
    );

    expect(result.PATH).toBe("/usr/bin");
    expect(result.HOME).toBe("/home/user");
    expect(result.OPENAI_API_KEY).toBeUndefined();
    expect(result.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(result.RANDOM_ENV).toBeUndefined();
  });

  it("secret bindings override allowlisted vars", () => {
    const result = buildSanitizedEnv(
      { PATH: "/usr/bin" },
      { OPENAI_API_KEY: "sk-resolved-from-vault", AGENT_COMPANY_API_URL: "http://127.0.0.1:9999" },
    );

    expect(result.PATH).toBe("/usr/bin");
    expect(result.OPENAI_API_KEY).toBe("sk-resolved-from-vault");
    expect(result.AGENT_COMPANY_API_URL).toBe("http://127.0.0.1:9999");
  });

  it("produces empty env when host has no allowlisted vars", () => {
    const result = buildSanitizedEnv(
      { DANGEROUS_VAR: "should-not-appear" },
      {},
    );
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe("buildRedactor", () => {
  it("redacts secret values from log text", () => {
    const redact = buildRedactor({
      OPENAI_API_KEY: "sk-test-secret-12345",
      ANTHROPIC_API_KEY: "sk-ant-secret-67890",
    });

    const text = "Calling API with key sk-test-secret-12345 and sk-ant-secret-67890";
    const result = redact(text);
    expect(result).toBe("Calling API with key [REDACTED] and [REDACTED]");
  });

  it("does not redact short values or system vars", () => {
    const redact = buildRedactor({
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/Users/testuser",
      SHORT: "abc",
    });

    const text = "PATH=/usr/local/bin:/usr/bin HOME=/Users/testuser SHORT=abc";
    expect(redact(text)).toBe(text);
  });

  it("handles multiple occurrences of the same secret", () => {
    const redact = buildRedactor({
      TOKEN: "my-secret-token-value",
    });

    const text = "Token: my-secret-token-value and again: my-secret-token-value";
    expect(redact(text)).toBe("Token: [REDACTED] and again: [REDACTED]");
  });

  it("returns identity function when no secrets present", () => {
    const redact = buildRedactor({});
    const text = "No secrets here";
    expect(redact(text)).toBe(text);
  });
});
