import { expect, type ElectronApplication, type Page } from "@playwright/test";

/** Runs the setup wizard with a fake OpenAI key and enters the app. */
export async function onboard(page: Page, company: string): Promise<void> {
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByLabel("API key").fill("e2e-secret");
  await page.getByLabel("Model").fill("gpt-5.4");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Company name").fill(company);
  await page.getByLabel("Your name").fill("Dana Lee");
  await page.getByLabel("Description").fill("d");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Goal").fill("Ship.");
  await page.getByLabel("Acceptance criteria").fill("It ships.");
  await page.getByRole("button", { name: "Launch" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
}

/** Closes the app, answering the unsaved-input question (a native dialog Playwright cannot click) with "discard". */
export async function closeApp(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 0;
  });
  await app.close();
}
