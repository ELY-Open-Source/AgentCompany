import { afterEach, describe, expect, test, vi } from "vitest";
import { parseAnthropicCompatProfile, parseOpenAiCompatProfile } from "../../src/main/services/provider-auth-profiles";
import { runCustomAnthropicTurn, runCustomOpenAiTurn } from "../../src/main/services/provider-tool-turns/turns";

const profile = (baseUrl: string, secret = "") => parseOpenAiCompatProfile(JSON.stringify({ baseUrl, secret }));

afterEach(() => vi.unstubAllGlobals());

describe("custom endpoints on this computer or the local network", () => {
  test("plain HTTP is allowed for loopback, private networks and .local names, and the key may be empty", () => {
    for (const url of ["http://localhost:11434/v1", "http://127.0.0.1:1234/v1", "http://[::1]:8080/v1", "http://10.0.0.5/v1", "http://172.20.1.1:8000/v1", "http://192.168.1.20:1234/v1", "http://studio.local:8080/v1"]) {
      expect(profile(url)).toEqual({ type: "openai_compat", baseUrl: url.replace(/\/$/, ""), apiKey: null });
    }
    expect(parseAnthropicCompatProfile(JSON.stringify({ baseUrl: "http://localhost:8080", secret: "" }))).toEqual({ type: "anthropic_compat", baseUrl: "http://localhost:8080", apiKey: null });
    expect(profile("https://api.example.com/v1", " sk-1 ")).toEqual({ type: "openai_compat", baseUrl: "https://api.example.com/v1", apiKey: "sk-1" });
  });

  test("plain HTTP to anywhere else is refused, since the key and prompts would cross the internet in the clear", () => {
    for (const url of ["http://api.example.com/v1", "http://172.32.0.1/v1", "http://8.8.8.8/v1", "http://localhost.example.com/v1"]) {
      expect(() => profile(url)).toThrow("Base URL must use HTTPS unless it is on this computer or the local network.");
    }
  });

  test("a turn without a key sends no auth header; with one it does", async () => {
    const headers: Array<Record<string, string>> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      headers.push(init.headers as Record<string, string>);
      const body = String(url).endsWith("/messages")
        ? { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }
        : { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    const input = { model: "llama3", instructions: null, messages: [{ role: "user" as const, text: "hi" }], tools: [] };
    await runCustomOpenAiTurn({ ...input, credential: { baseUrl: "http://localhost:11434/v1" } });
    await runCustomOpenAiTurn({ ...input, credential: { baseUrl: "http://localhost:11434/v1", apiKey: "sk-1" } });
    await runCustomAnthropicTurn({ ...input, credential: { baseUrl: "http://localhost:8080" } });
    expect(headers.map((sent) => sent.authorization ?? sent["x-api-key"] ?? null)).toEqual([null, "Bearer sk-1", null]);
  });
});
