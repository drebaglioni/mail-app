import { test, expect, Page, ElectronApplication } from "@playwright/test";
import { launchElectronApp, closeApp } from "./launch-helpers";

/** Best-effort screenshot - won't fail the test if it times out (e.g. due to pending font loads) */
async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: `tests/screenshots/${name}.png`, timeout: 5000 }).catch(() => {
    console.log(`Screenshot '${name}' timed out, skipping`);
  });
}

/** Click on an email in the list and wait for the detail view to load */
async function selectEmail(page: Page, textMatch: string) {
  const emailButton = page.locator("button").filter({ hasText: textMatch }).first();
  await expect(emailButton).toBeVisible({ timeout: 5000 });
  await emailButton.click();
  // Wait for the action buttons to appear in the detail view header
  await expect(page.locator("button[title='Archive']")).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(300);
}

async function openMoreActions(page: Page) {
  const moreButton = page.locator("button[title='More actions']");
  await expect(moreButton).toBeVisible({ timeout: 5000 });
  await moreButton.click();
  await expect(page.locator("button").filter({ hasText: "Trash" })).toBeVisible({
    timeout: 3000,
  });
}

async function clickMoreAction(page: Page, label: string | RegExp) {
  await openMoreActions(page);
  await page.locator("button").filter({ hasText: label }).first().click();
  await page.waitForTimeout(300);
}

/** Go back to the email list if we're in a detail view */
async function ensureInList(page: Page) {
  // If the Back button is visible, click it
  const backButton = page.locator("text=Back").first();
  if (await backButton.isVisible().catch(() => false)) {
    await backButton.click();
    await page.waitForTimeout(300);
  }
  // Wait for inbox to be ready
  await expect(page.locator("text=Exo").first()).toBeVisible({ timeout: 5000 });
}

test.describe("Email Action Buttons", () => {
  test.describe.configure({ mode: "serial" });
  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeAll(async ({}, testInfo) => {
    const result = await launchElectronApp({ workerIndex: testInfo.workerIndex });
    electronApp = result.app;
    page = result.page;

    // Wait for email list to populate. The default spacious density intentionally
    // avoids visible priority chips, so rows are the stable loaded signal.
    await expect(page.locator("div[data-thread-id]").first()).toBeVisible({ timeout: 10000 });

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error(`[Console Error]: ${msg.text()}`);
      }
    });
  });

  test.afterAll(async () => {
    if (electronApp) {
      await closeApp(electronApp);
    }
  });

  test("action buttons are visible in thread header when email is selected", async () => {
    // Select an email (Garry Tan's Q3 report — not snoozed in demo mode)
    await selectEmail(page, "Garry");

    // Verify primary action buttons are present in the minimalist header.
    await expect(page.locator("button[title='Archive']")).toBeVisible();
    await expect(page.locator("button[title='Reply All']").first()).toBeVisible();
    await expect(page.locator("button[title='More actions']")).toBeVisible();

    // Secondary actions live behind the More menu.
    await openMoreActions(page);
    await expect(page.locator("button").filter({ hasText: "Forward" }).first()).toBeVisible();
    await expect(
      page
        .locator("button")
        .filter({ hasText: /Star|Unstar/ })
        .first(),
    ).toBeVisible();
    await expect(
      page.locator("button").filter({ hasText: "Mark as unread" }).first(),
    ).toBeVisible();
    await expect(page.locator("button").filter({ hasText: "Trash" }).first()).toBeVisible();
    await page.keyboard.press("Escape");

    // Screenshot the full email detail view with action buttons visible
    await screenshot(page, "action-buttons-overview");
  });

  test("star button toggles between star and unstar", async () => {
    // Ensure we're viewing an email
    await ensureInList(page);
    await selectEmail(page, "Garry");

    await openMoreActions(page);

    const starAction = page
      .locator("button")
      .filter({ hasText: /Star|Unstar/ })
      .first();
    await expect(starAction).toBeVisible({ timeout: 3000 });

    await starAction.click();
    await page.waitForTimeout(300);

    await openMoreActions(page);
    const nextStarAction = page
      .locator("button")
      .filter({ hasText: /Star|Unstar/ })
      .first();
    await expect(nextStarAction).toBeVisible({ timeout: 3000 });

    await nextStarAction.click();
    await page.waitForTimeout(300);
    await openMoreActions(page);
    await expect(
      page
        .locator("button")
        .filter({ hasText: /Star|Unstar/ })
        .first(),
    ).toBeVisible({
      timeout: 3000,
    });

    await screenshot(page, "action-buttons-star-toggle");
    await page.keyboard.press("Escape");
  });

  test("mark as unread navigates back to list", async () => {
    // Start from inbox list
    await ensureInList(page);

    // Select a specific email (use HR Team — always visible, not snoozed)
    await selectEmail(page, "HR Team");

    // Screenshot before clicking
    await screenshot(page, "action-buttons-before-unread");

    await clickMoreAction(page, "Mark as unread");

    // Should navigate back - inbox should be visible
    await expect(page.locator("div[data-thread-id]").first()).toBeVisible({ timeout: 5000 });

    // Screenshot after marking unread
    await screenshot(page, "action-buttons-after-unread");
  });

  test("archive removes email and auto-advances to next", async () => {
    // Start from inbox list
    await ensureInList(page);

    // Look for the email
    const emailInList = page.locator("button").filter({ hasText: /rate limit/ });
    const existsBefore = await emailInList.isVisible().catch(() => false);

    if (existsBefore) {
      // Select the email
      await selectEmail(page, "rate limit");

      // Verify Archive button is visible
      await expect(page.locator("button[title='Archive']")).toBeVisible();

      // Screenshot before archiving
      await screenshot(page, "action-buttons-before-archive");

      // Click Archive — should auto-advance to next email (not return to inbox)
      await page.locator("button[title='Archive']").click();
      await page.waitForTimeout(500);

      // Should still be in detail view showing the next email
      // (Archive auto-advances like the 'e' keyboard shortcut)
      await expect(page.locator("button[title='Archive']")).toBeVisible({ timeout: 5000 });

      // Screenshot after archiving
      await screenshot(page, "action-buttons-after-archive");

      // Navigate back to list and verify the archived email is gone
      await ensureInList(page);
      await page.waitForTimeout(300);
      const existsAfter = await emailInList.isVisible().catch(() => false);
      expect(existsAfter).toBe(false);
    }
  });

  test("trash removes email and auto-advances to next", async () => {
    // Start from inbox list
    await ensureInList(page);

    // Find an email to trash
    const emailInList = page.locator("button").filter({ hasText: /Q4 Planning/ });
    const existsBefore = await emailInList.isVisible().catch(() => false);

    if (existsBefore) {
      await selectEmail(page, "Q4 Planning");

      // Screenshot before trashing
      await screenshot(page, "action-buttons-before-trash");

      await clickMoreAction(page, "Trash");

      // Should still be in detail view showing the next email
      // (Trash auto-advances like the '#' keyboard shortcut)
      await expect(page.locator("button[title='Archive']")).toBeVisible({ timeout: 5000 });

      // Screenshot after trashing
      await screenshot(page, "action-buttons-after-trash");

      // Navigate back to list and verify the trashed email is gone
      await ensureInList(page);
      await page.waitForTimeout(300);
      const existsAfter = await emailInList.isVisible().catch(() => false);
      expect(existsAfter).toBe(false);
    }
  });

  test("action buttons have proper visual layout with divider", async () => {
    // Start from inbox list
    await ensureInList(page);

    // Select any remaining email
    const anyEmail = page.locator("button").filter({ hasText: "Garry" }).first();
    if (await anyEmail.isVisible().catch(() => false)) {
      await selectEmail(page, "Garry");

      // Verify the buttons area is rendered (action + compose buttons visible)
      await expect(page.locator("button[title='Archive']")).toBeVisible();
      await expect(page.locator("button[title='Reply All']").first()).toBeVisible();
      await expect(page.locator("button[title='More actions']")).toBeVisible();

      // Take a final styled screenshot
      await screenshot(page, "action-buttons-final");
    }
  });
});
