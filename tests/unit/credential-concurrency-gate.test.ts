import { describe, expect, it } from "vitest";
import { InMemoryCredentialConcurrencyGate } from "../../src/main/worker/runtime/credential-concurrency-gate";

function makeGate(limit: number | null) {
  return new InMemoryCredentialConcurrencyGate(() => limit);
}

describe("InMemoryCredentialConcurrencyGate", () => {
  it("returns a no-op release when the provider is uncapped", async () => {
    const gate = makeGate(null);
    const release = await gate.acquire("anthropic", "key-x");
    expect(typeof release).toBe("function");
    release();
    release();
  });

  it("hands out slots up to the limit immediately", async () => {
    const gate = makeGate(2);
    const r1 = await gate.acquire("fireworks-firepass", "shared");
    const r2 = await gate.acquire("fireworks-firepass", "shared");
    expect(r1).not.toBe(r2);
    r1();
    r2();
  });

  it("queues the third caller until a slot is released", async () => {
    const gate = makeGate(1);
    const release = await gate.acquire("fireworks-firepass", "shared");
    const order: string[] = [];

    const second = (async () => {
      const r = await gate.acquire("fireworks-firepass", "shared");
      order.push("second");
      r();
    })();
    const third = (async () => {
      const r = await gate.acquire("fireworks-firepass", "shared");
      order.push("third");
      r();
    })();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual([]);

    release();
    await second;
    expect(order).toEqual(["second"]);

    await third;
    expect(order).toEqual(["second", "third"]);
  });

  it("scopes pools by (provider, apiKey) so different keys do not block each other", async () => {
    const gate = makeGate(1);
    const r1 = await gate.acquire("fireworks-firepass", "key-a");
    // Different apiKey -> new pool, no waiting.
    const r2 = await gate.acquire("fireworks-firepass", "key-b");
    expect(typeof r1).toBe("function");
    expect(typeof r2).toBe("function");
    r1();
    r2();
  });

  it("releases the pool when no callers remain", async () => {
    const gate = makeGate(1);
    const release = await gate.acquire("fireworks-firepass", "shared");
    release();
    // Re-acquire should not be queued.
    const next = await gate.acquire("fireworks-firepass", "shared");
    next();
  });

  it("rejects when the abort signal fires while waiting", async () => {
    const gate = makeGate(1);
    const held = await gate.acquire("fireworks-firepass", "shared");

    const controller = new AbortController();
    const pending = gate.acquire("fireworks-firepass", "shared", controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    // Slot must remain available after the aborted waiter is removed.
    held();
    const next = await gate.acquire("fireworks-firepass", "shared");
    next();
  });

  it("rejects immediately when the abort signal is already aborted", async () => {
    const gate = makeGate(1);
    const controller = new AbortController();
    controller.abort();
    await expect(
      gate.acquire("fireworks-firepass", "shared", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("treats double-release as a no-op", async () => {
    const gate = makeGate(1);
    const release = await gate.acquire("fireworks-firepass", "shared");
    release();
    release();
    const next = await gate.acquire("fireworks-firepass", "shared");
    next();
  });
});
