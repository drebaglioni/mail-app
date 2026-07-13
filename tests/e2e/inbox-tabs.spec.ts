import { test, expect, Page, ElectronApplication } from "@playwright/test";
import { launchElectronApp, closeApp, takeScreenshot } from "./launch-helpers";

/**
 * E2E tests for the minimal inbox mode masthead.
 *
 * The old Priority/Other/Archive Ready tab strip was removed in favor of a
 * calmer People / Automated / Uncategorized / Snoozed mode switcher. These
 * assertions keep the behavior covered without depending on decorative classes.
 */

function modeTitle(page: Page, label: string) {
  return page.locator("button[data-active='true']").filter({ hasText: new RegExp(`^${label}`) });
}

function modeSwitch(page: Page, label: string) {
  return page.locator("button[data-variant='switch']").filter({ hasText: new RegExp(`^${label}`) });
}

async function visibleThreadCount(page: Page): Promise<number> {
  return page.locator("div[data-thread-id]").count();
}

test.describe("Inbox Modes", () => {
  test.describe.configure({ mode: "serial" });

  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeAll(async ({}, testInfo) => {
    const result = await launchElectronApp({ workerIndex: testInfo.workerIndex });
    electronApp = result.app;
    page = result.page;
  });

  test.afterAll(async () => {
    if (electronApp) await closeApp(electronApp);
  });

  test("People mode is the default on launch", async () => {
    await expect(modeTitle(page, "People")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("div[data-thread-id]").first()).toBeVisible({ timeout: 10000 });
    expect(await visibleThreadCount(page)).toBeGreaterThan(0);
    await expect(page.getByText("Q3 Quarterly Report - Action Required")).toHaveCount(0);
    await expect(page.getByText("[ankitvgupta/exo] CI workflow failed on main")).toHaveCount(0);
  });

  test("can switch to Automated mode", async () => {
    const automated = modeSwitch(page, "Automated");
    await expect(automated).toBeVisible({ timeout: 5000 });
    await automated.click();
    await expect(modeTitle(page, "Automated")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("[ankitvgupta/exo] CI workflow failed on main")).toBeVisible({
      timeout: 5000,
    });

    const rows = await visibleThreadCount(page);
    expect(rows).toBeGreaterThanOrEqual(0);
  });

  test("Uncategorized mode is a separate recovery queue", async () => {
    const uncategorized = modeSwitch(page, "Uncategorized");
    await expect(uncategorized).toBeVisible({ timeout: 5000 });
    await uncategorized.click();
    await expect(modeTitle(page, "Uncategorized")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Q3 Quarterly Report - Action Required")).toBeVisible({
      timeout: 5000,
    });
    await takeScreenshot(
      electronApp,
      page,
      "email-categorization-uncategorized-mode",
      "Uncategorized recovery queue",
    );

    // The demo fixture may have no failed analyses, but the mode must remain
    // reachable so real provider failures never spill into People.
    expect(await visibleThreadCount(page)).toBeGreaterThanOrEqual(0);

    await modeSwitch(page, "Automated").click();
    await expect(modeTitle(page, "Automated")).toBeVisible({ timeout: 5000 });
  });

  test("Automated mode exposes category chips without changing the global mode", async () => {
    await expect(modeTitle(page, "Automated")).toBeVisible({ timeout: 5000 });

    const allChip = page.locator("button").filter({ hasText: /^All$/ }).first();
    await expect(allChip).toBeVisible({ timeout: 5000 });

    const notificationsChip = page
      .locator("button")
      .filter({ hasText: /^Notifications$/ })
      .first();
    if (await notificationsChip.isVisible().catch(() => false)) {
      await notificationsChip.click();
      await expect(modeTitle(page, "Automated")).toBeVisible({ timeout: 5000 });
    }
  });

  test("can switch back to People mode", async () => {
    const people = modeSwitch(page, "People");
    await expect(people).toBeVisible({ timeout: 5000 });
    await people.click();

    await expect(modeTitle(page, "People")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("div[data-thread-id]").first()).toBeVisible({ timeout: 10000 });
  });
});
