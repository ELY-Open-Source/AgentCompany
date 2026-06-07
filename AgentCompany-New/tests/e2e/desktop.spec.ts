import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

test("onboards, hires, and creates work in the Electron shell", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-e2e-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const app = await electron.launch({
    args: [resolve("out/main/index.js")],
    env: {
      ...process.env,
      AGENTCOMPANY_NEW_PROFILE_DIR: profileDir,
      AGENTCOMPANY_NEW_AUTORUN: "0",
    },
  });

  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByLabel("API key").fill("e2e-secret");
    await page.getByLabel("Model").fill("gpt-5.4");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Company name").fill("Acme Operations");
    await page.getByLabel("Your name").fill("Dana Lee");
    await page.getByLabel("Description").fill("Coordinate agents with auditable approvals.");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Goal").fill("Ship a verified control plane.");
    await page.getByLabel("Acceptance criteria").fill("The CEO creates the kickoff operating loop.");
    await page.getByRole("button", { name: "Launch" }).click();

    await expect(page.getByRole("button", { name: /Acme Operations/ })).toBeVisible();
    await page.getByRole("button", { name: "Team" }).click();
    await page.getByRole("button", { name: "Hire" }).click();
    await page.getByLabel("Name").fill("Alex Chen");
    await page.getByLabel("Role").fill("CTO");
    await page.getByLabel("Department").fill("Engineering");
    await page.getByLabel("Monthly budget").fill("250");
    await page.locator(".modal").getByRole("button", { name: "Hire" }).click();
    await expect(page.getByText("Alex Chen").first()).toBeVisible();
    const hiredAgent = await page.evaluate(async () => {
      const api = (window as unknown as { agentCompany: { loadSnapshot: () => Promise<unknown> } }).agentCompany;
      const result = await api.loadSnapshot() as {
        ok: true;
        data: {
          agents: Array<{ name: string; modelProviderId: string | null; modelId: string | null; workspaceId: string | null; heartbeatEnabled: boolean; heartbeatIntervalSec: number }>;
          workspaces: Array<{ id: string; isPrimary: boolean }>;
        };
      };
      const agent = result.data.agents.find((item) => item.name === "Alex Chen");
      const primaryWorkspace = result.data.workspaces.find((item) => item.isPrimary) ?? null;
      return {
        modelProviderId: agent?.modelProviderId ?? null,
        modelId: agent?.modelId ?? null,
        workspaceId: agent?.workspaceId ?? null,
        heartbeatEnabled: agent?.heartbeatEnabled ?? false,
        heartbeatIntervalSec: agent?.heartbeatIntervalSec ?? 0,
        primaryWorkspaceId: primaryWorkspace?.id ?? null,
      };
    });
    expect(hiredAgent.modelProviderId).toBeTruthy();
    expect(hiredAgent.modelId).toBe("gpt-5.4");
    expect(hiredAgent.workspaceId).toBe(hiredAgent.primaryWorkspaceId);
    expect(hiredAgent.heartbeatEnabled).toBe(true);
    expect(hiredAgent.heartbeatIntervalSec).toBe(120);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Members" }).click();
    await expect(page.getByText("Identity & Access")).toBeVisible();
    await expect(page.getByText("org admin").first()).toBeVisible();
    await expect(page.getByText("scoped agent").first()).toBeVisible();
    await page.getByRole("button", { name: "Policies" }).click();
    await expect(page.getByText("Hiring policies")).toBeVisible();
    await expect(page.getByText("Review routing")).toBeVisible();
    await page.getByRole("button", { name: "Operations", exact: true }).click();
    await expect(page.getByText("Feature flags")).toBeVisible();
    await expect(page.getByText("SLO targets")).toBeVisible();
    await expect(page.getByText("Chaos drills").first()).toBeVisible();
    await page.getByRole("button", { name: "Run" }).first().click();
    await expect(page.getByText("passed").first()).toBeVisible();
    await page.getByRole("button", { name: "SDLC", exact: true }).click();
    await expect(page.getByText("Review agents", { exact: true })).toBeVisible();
    await expect(page.getByText("Eval suites", { exact: true })).toBeVisible();
    await expect(page.getByText("PR bot gates", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Run" }).first().click();
    await expect(page.getByText("passed").first()).toBeVisible();
    await page.getByRole("button", { name: "Run" }).nth(3).click();
    await expect(page.getByText(/passed ·/).first()).toBeVisible();

    await page.getByRole("button", { name: "Work", exact: true }).click();
    await page.getByRole("button", { name: "New task" }).click();
    await page.getByLabel("Title").fill("Production deploy");
    await page.getByLabel("Description").fill("Deploy a high-risk change.");
    await page.getByLabel("Risk").selectOption("high");
    await page.locator(".modal").getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Production deploy").first()).toBeVisible();
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("textbox", { name: "Search query" }).fill("production");
    await expect(page.getByText("Production deploy").first()).toBeVisible();
    await page.getByRole("dialog", { name: "Search" }).getByRole("button").filter({ hasText: "Production deploy" }).first().click();

    await page.getByRole("button", { name: "Approvals" }).click();
    await expect(page.getByText("Production deploy").first()).toBeVisible();

    await page.getByRole("button", { name: "Messages" }).click();
    await page.getByRole("button", { name: "New space" }).click();
    await page.getByLabel("Name").fill("release");
    await page.getByLabel("Topic").fill("Release coordination");
    await page.locator(".modal").getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("release").first()).toBeVisible();
    await page.getByRole("textbox", { name: "Message" }).fill("/escalate @Board review release plan");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("@Board").first()).toBeVisible();
    await expect(page.getByText("/escalate").first()).toBeVisible();
    await page.getByRole("button", { name: "Open thread" }).first().click();
    await expect(page.getByText("Audit")).toBeVisible();
    await expect(page.getByText("Chat message sent").first()).toBeVisible();
    await expect(page.getByText("Approval requested").first()).toBeVisible();
    await page.getByRole("button", { name: "Approvals" }).click();
    await expect(page.getByText("Escalate release").first()).toBeVisible();

    await page.getByRole("button", { name: "Social" }).click();
    await page.getByRole("button", { name: "Connect account" }).click();
    await page.getByLabel("Handle").fill("@acme");
    await page.getByLabel("Display name").fill("Acme Social");
    await page.locator(".modal").getByRole("button", { name: "Connect" }).click();
    await expect(page.getByText("@acme").first()).toBeVisible();
    await page.getByRole("button", { name: "Draft post" }).click();
    await page.getByLabel("Body").fill("Pilot starts Friday.");
    await page.getByLabel("Scheduled for").fill("2027-01-15T09:30");
    await page.locator(".modal").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Draft").first()).toBeVisible();
    await page.getByRole("button", { name: "Schedule" }).click();
    await expect(page.getByText("Awaiting approval").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();

    await page.getByRole("button", { name: "Approvals" }).click();
    await expect(page.getByText("Approve social post").first()).toBeVisible();
    await page.getByLabel("Filter risk").selectOption("medium");
    await page.getByRole("button", { name: /^Approve$/ }).first().click();
    await page.getByRole("button", { name: "Social" }).click();
    await expect(page.getByText("Approved").first()).toBeVisible();
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Published").first()).toBeVisible();

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Providers" }).click();
    await page.getByLabel("OpenAI background execution").check();
    await page.getByRole("button", { name: "Save OpenAI policy" }).click();
    await expect(page.getByText("Requests", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Request provider")).toBeVisible();
    await expect(page.getByRole("button", { name: "Background" })).toBeVisible();
    await page.getByLabel("Request prompt").fill("Draft a provider control memo.");
    await page.getByLabel("Request instructions").fill("Use direct language.");
    await page.getByLabel("OpenAI data policy").selectOption("zero_data_retention");
    await expect(page.getByLabel("OpenAI background execution")).not.toBeChecked();
    await page.getByLabel("OpenAI monthly request limit").fill("25");
    await page.getByRole("button", { name: "Save OpenAI policy" }).click();
    await expect(page.getByText("0 / 25").first()).toBeVisible();
    await page.getByRole("button", { name: "Skills" }).click();
    await page.getByRole("button", { name: "Import" }).click();
    await page.getByLabel("Directory path").fill(createSkillDirectory());
    await page.locator(".modal").getByRole("button", { name: "Import" }).click();
    await expect(page.getByText("Release Gate").first()).toBeVisible();
    await expect(page.getByText("Never run").first()).toBeVisible();
    await page.getByRole("button", { name: "Run tests" }).click();
    await expect(page.getByText("1/1 passed").first()).toBeVisible();
    await page.getByRole("button", { name: "Compliance" }).click();
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("gdpr export · employee").first()).toBeVisible();
    await expect(page.getByText("Thread replay")).toBeVisible();
    await page.getByRole("button", { name: "Run" }).click();
    await expect(page.getByText("Replay runs", { exact: true })).toBeVisible();
    await expect(page.getByText(/\d+ events ·/).first()).toBeVisible();

    const legacyPath = createLegacyDatabase();
    await page.getByRole("button", { name: "Migration" }).click();
    await page.getByRole("button", { name: "Report" }).click();
    await page.getByLabel("Source database path").fill(legacyPath);
    await page.locator(".modal").getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("organizations: 1").first()).toBeVisible();
    await page.getByRole("button", { name: "Snapshot" }).click();
    await expect(page.getByText("Rollback snapshots", { exact: true })).toBeVisible();
    await expect(page.getByText(/\d+ workspaces/).first()).toBeVisible();
    await page.getByRole("button", { name: "Set", exact: true }).click();
    await expect(page.getByRole("button", { name: "active", exact: true })).toBeDisabled();

    await verifyPagesDoNotOverflow(page);
  } finally {
    await app.close();
  }
});

function createLegacyDatabase(): string {
  const legacyPath = join(tmpdir(), `agentcompany-legacy-${randomUUID()}.db`);
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec("create table organizations(id text primary key); insert into organizations(id) values ('legacy-org');");
  legacy.close();
  return legacyPath;
}

function createSkillDirectory(): string {
  const root = join(tmpdir(), `agentcompany-skill-${randomUUID()}`);
  mkdirSync(join(root, "checks"), { recursive: true });
  writeFileSync(join(root, "SKILL.md"), "Review release evidence and produce a concise gate decision.\n", "utf8");
  writeFileSync(join(root, "checks", "acceptance.txt"), "release evidence accepted\n", "utf8");
  writeFileSync(join(root, "skill.manifest.json"), JSON.stringify({
    name: "Release Gate",
    version: "1.0.0",
    entrypoint: "SKILL.md",
    capabilities: ["release-review"],
    required_tools: ["git"],
    compatible_models: ["gpt-5.4"],
    risk_level: "low",
    tests: ["checks/acceptance.txt"],
    inputs: {},
    outputs: {},
  }, null, 2), "utf8");
  return root;
}

async function verifyPagesDoNotOverflow(page: Page): Promise<void> {
  for (const size of [{ width: 1280, height: 860 }, { width: 980, height: 700 }]) {
    await page.setViewportSize(size);
    for (const nav of ["Home", "Team", "Work", "Messages", "Files", "Approvals", "Social", "Settings"]) {
      await page.getByRole("button", { name: nav, exact: true }).click();
      await expectPageToFit(page);
    }
    for (const tab of ["Workspace", "Members", "Billing", "Models", "Providers", "Skills", "Policies", "Operations", "SDLC", "Compliance", "Migration", "Profile", "Notifications", "Security"]) {
      await page.getByRole("button", { name: "Settings" }).click();
      await page.getByRole("button", { name: tab, exact: true }).click();
      await expectPageToFit(page);
    }
  }
}

async function expectPageToFit(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
  }));
  expect(dimensions.documentScrollWidth).toBeLessThanOrEqual(dimensions.documentClientWidth + 1);
  expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth + 1);
}
