import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderCooldowns } from "../../src/main/services/provider-cooldowns";

describe("provider cooldown sizing", () => {
  test("a provider-given wait is honored; otherwise parks back off and reset once a request is served", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { connection, provider } = company();
    let now = 0;
    const cooldowns = new ProviderCooldowns(connection.db, () => now);
    const parkedFor = (): number => {
      let elapsed = 0;
      while (cooldowns.cooledProviderIds().includes(provider.id)) {
        now += 1_000;
        elapsed += 1_000;
      }
      return elapsed;
    };
    cooldowns.park(provider, "429", 45_000);
    expect(parkedFor()).toBe(45_000);
    cooldowns.park(provider, "503", null);
    expect(parkedFor()).toBe(4 * 60_000);
    cooldowns.park(provider, "503", null);
    expect(parkedFor()).toBe(8 * 60_000);
    cooldowns.clear(provider);
    cooldowns.park(provider, "503", null);
    expect(parkedFor()).toBe(2 * 60_000);
    cooldowns.park(provider, "429", 5 * 3_600_000);
    expect(parkedFor()).toBe(5 * 3_600_000);
    cooldowns.park(provider, "429", 30 * 3_600_000);
    expect(parkedFor()).toBe(24 * 3_600_000);
    vi.restoreAllMocks();
    connection.close();
  });

  test("a park survives a restart, so the queue does not hammer a provider that is still down", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { connection, provider } = company();
    let now = 1_000_000;
    new ProviderCooldowns(connection.db, () => now).park(provider, "503", null);
    new ProviderCooldowns(connection.db, () => now).park(provider, "503", null);
    const afterRestart = new ProviderCooldowns(connection.db, () => now);
    expect(afterRestart.cooledProviderIds()).toEqual([provider.id]);
    now += 4 * 60_000 - 1;
    expect(afterRestart.cooledProviderIds()).toEqual([provider.id]);
    now += 1;
    expect(afterRestart.cooledProviderIds()).toEqual([]);
    afterRestart.park(provider, "503", null);
    now += 8 * 60_000 - 1;
    expect(new ProviderCooldowns(connection.db, () => now).cooledProviderIds()).toEqual([provider.id]);
    vi.restoreAllMocks();
    connection.close();
  });
});

function company() {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-cooldown-${randomUUID()}.db`));
  let orgId = "";
  connection.transaction(() => {
    orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
  });
  const provider = connection.db.prepare("select id, label from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string; label: string };
  return { connection, provider };
}
