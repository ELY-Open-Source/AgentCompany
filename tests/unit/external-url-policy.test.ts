import { describe, expect, it } from "vitest";
import {
  classifyExternalUrl,
  normalizeExternalHttpUrl,
} from "../../src/main/external-url-policy";

describe("external URL policy", () => {
  it("normalizes http and https URLs", () => {
    expect(normalizeExternalHttpUrl(" https://github.com/agentcompany ")).toBe("https://github.com/agentcompany");
    expect(normalizeExternalHttpUrl("http://example.com/path?q=1")).toBe("http://example.com/path?q=1");
  });

  it("blocks custom schemes and credential-bearing URLs", () => {
    expect(classifyExternalUrl("vscode://file/etc/passwd")).toMatchObject({ kind: "blocked" });
    expect(classifyExternalUrl("https://user:pass@example.com/report")).toMatchObject({ kind: "blocked" });
  });

  it("separates trusted hosts from confirmation hosts", () => {
    expect(classifyExternalUrl("https://github.com/acme/repo")).toMatchObject({ kind: "trusted", host: "github.com" });
    expect(classifyExternalUrl("http://github.com/acme/repo")).toMatchObject({ kind: "confirm", host: "github.com" });
    expect(classifyExternalUrl("https://example.com/report")).toMatchObject({ kind: "confirm", host: "example.com" });
  });
});
