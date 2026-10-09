import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { buildFloorPlan } from "../../src/renderer/src/pages/office/floor-plan";
import { cameraFor } from "../../src/renderer/src/pages/office/simulation";
import { seedBuiltinSkillsFixture } from "./builtin-skills-fixture";

test("the office floor opens agent details on click", async () => {
  const profileDir = join(tmpdir(), `agentcompany-new-office-${randomUUID()}`);
  mkdirSync(profileDir, { recursive: true });
  const app = await electron.launch({
    args: [resolve("out/main/index.js")],
    env: {
      ...process.env,
      AGENTCOMPANY_NEW_PROFILE_DIR: profileDir,
      AGENTCOMPANY_NEW_AUTORUN: "0",
      AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR: seedBuiltinSkillsFixture(join(profileDir, "builtin-src")),
    },
  });

  try {
    const page = await app.firstWindow();
    // The office renders in a rAF loop; a throwing frame (e.g. a broken
    // effect draw) surfaces only as a page error, so collect them.
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByLabel("API key").fill("office-e2e-key");
    await page.getByLabel("Model").fill("gpt-5.4");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Company name").fill("Pixel Works");
    await page.getByLabel("Your name").fill("Morgan Reyes");
    await page.getByLabel("Description").fill("Office e2e coverage.");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Goal").fill("Verify the office floor.");
    await page.getByLabel("Acceptance criteria").fill("Clicking an agent opens their card.");
    await page.getByRole("button", { name: "Launch" }).click();
    await expect(page.getByRole("heading", { name: "Connectors" })).toBeVisible();
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByRole("button", { name: /Pixel Works/ })).toBeVisible();

    await page.getByRole("button", { name: "Office", exact: true }).click();
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    await page.waitForTimeout(300);

    // Onboarding seeds exactly one agent (the CEO), so the floor plan and
    // camera are fully determined by the same pure modules the app uses.
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const plan = buildFloorPlan(0);
    const camera = cameraFor(plan.world, box!.width, box!.height, plan.entrance);
    const clickX = box!.x + plan.ceoSeat.x - camera.x;
    const clickY = box!.y + plan.ceoSeat.y - 20 - camera.y;

    await page.mouse.click(clickX, clickY);
    const card = page.getByRole("dialog", { name: "Agent CEO" });
    await expect(card).toBeVisible();
    await expect(card.getByText("CEO", { exact: true })).toBeVisible();
    await expect(card.getByText("Chief Executive Officer")).toBeVisible();
    await expect(card.getByText("Executive", { exact: true })).toBeVisible();

    // The card sits beside the clicked agent, not pinned to a screen corner.
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    const gapToSprite = Math.min(
      Math.abs(cardBox!.x - clickX),
      Math.abs(cardBox!.x + cardBox!.width - clickX),
    );
    expect(gapToSprite).toBeLessThan(80);
    expect(Math.abs(cardBox!.y + cardBox!.height / 2 - clickY)).toBeLessThan(160);

    await page.keyboard.press("Escape");
    await expect(card).not.toBeVisible();

    // Clicking empty corridor floor selects nothing.
    await page.mouse.click(box!.x + 500 - camera.x, box!.y + 320 - camera.y);
    await expect(page.getByRole("dialog", { name: /Agent / })).not.toBeVisible();

    // WASD input is accepted without disturbing the page.
    for (const key of ["KeyD", "KeyS", "KeyA", "KeyW"]) {
      await page.keyboard.down(key);
      await page.waitForTimeout(120);
      await page.keyboard.up(key);
    }
    await expect(canvas).toBeVisible();

    // The office offers no pretend controls over work, and says what a position means.
    await expect(page.getByRole("button", { name: "Whip" })).toHaveCount(0);
    await expect(page.getByText("Agents with work stay at their desks. Only idle agents walk to coffee, snacks or the meeting table.")).toBeVisible();

    // Hired agents take open-floor desks in hire order and are clickable too.
    await hireAgent(page, "Ava Patel", "Designer", "Design");
    await hireAgent(page, "Ken Ito", "Engineer", "Engineering");
    await page.getByRole("button", { name: "Office", exact: true }).click();
    await expect(canvas).toBeVisible();
    await page.waitForTimeout(300);

    const populated = buildFloorPlan(2);
    const populatedBox = await canvas.boundingBox();
    const populatedCamera = cameraFor(populated.world, populatedBox!.width, populatedBox!.height, populated.entrance);
    const firstDesk = populated.desks[0].seat;
    await page.mouse.click(
      populatedBox!.x + firstDesk.x - populatedCamera.x,
      populatedBox!.y + firstDesk.y - 20 - populatedCamera.y,
    );
    const avaCard = page.getByRole("dialog", { name: "Agent Ava Patel" });
    await expect(avaCard).toBeVisible();
    await expect(avaCard.getByText("Design", { exact: true })).toBeVisible();

    const outDir = resolve("test-results/screenshots");
    mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: join(outDir, "19-office-populated.png"), fullPage: false });

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

async function hireAgent(page: Page, name: string, role: string, department: string): Promise<void> {
  await page.getByRole("button", { name: "Team", exact: true }).click();
  await page.getByRole("button", { name: "Hire", exact: true }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Role").fill(role);
  await page.getByLabel("Department").fill(department);
  await page.getByLabel("Monthly budget").fill("100");
  await page.locator(".modal").getByRole("button", { name: "Hire" }).click();
  await expect(page.getByText(name).first()).toBeVisible();
}
