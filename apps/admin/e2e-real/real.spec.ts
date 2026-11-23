import { expect, test, type Page } from "@playwright/test";

const run = Date.now().toString(36);
const PW_A = process.env.M12_PW_A!, PW_B = process.env.M12_PW_B!;
const OWNER_A = process.env.M12_OWNER_A ?? "owner-a@m12.test", OWNER_B = process.env.M12_OWNER_B ?? "owner-b@m12.test";
const VIEWER_PW = `viewer-${run}-pw-long`;

async function login(page: Page, email: string, pw: string) {
  await page.goto("/admin/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pw);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("role")).toBeVisible();
}

test("real API: owner works the console, AI is off with no key, viewer is read-only, paper B is untouched", async ({ page, browser }) => {
  await login(page, OWNER_A, PW_A);
  await expect(page.getByTestId("role")).toHaveText("owner");

  // AI: off by default, switch disabled, reason in plain words
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("switch", { name: "AI help" })).toBeDisabled();
  await expect(page.getByTestId("ai-reason")).toContainText("No AI key");

  // an edition for a date, no auto-plan needed here (no worker in this run)
  await page.getByRole("link", { name: "Editions" }).click();
  await page.getByLabel("Date of the edition").fill("2026-12-01");
  await page.getByRole("button", { name: "Create edition" }).click();
  await expect(page.getByTestId("edition-detail")).toContainText("2026-12-01");
  await expect(page.getByTestId("next-step")).toContainText("Auto-plan");

  // add a viewer
  const email = `viewer-${run}@m12.test`;
  await page.getByRole("link", { name: "People" }).click();
  await page.getByLabel("Name").fill("Vi Viewer");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/First password/).fill(VIEWER_PW);
  await page.getByRole("form", { name: "Add a person" }).locator("select").selectOption("viewer");
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByTestId("member")).toHaveCount(2);

  // paper B owner sees none of this
  const ctxB = await browser.newContext();
  const pb = await ctxB.newPage();
  await login(pb, OWNER_B, PW_B);
  await pb.getByRole("link", { name: "People" }).click();
  await expect(pb.getByTestId("member")).toHaveCount(1);
  await expect(pb.getByText("Vi Viewer")).toHaveCount(0);
  await pb.getByRole("link", { name: "Editions" }).click();
  await expect(pb.getByTestId("edition-row")).toHaveCount(0);
  await ctxB.close();

  // the viewer: read-only, and the real server refuses writes
  const ctxV = await browser.newContext();
  const pv = await ctxV.newPage();
  await login(pv, email, VIEWER_PW);
  await expect(pv.getByTestId("role")).toHaveText("viewer");
  await expect(pv.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(pv.getByRole("button", { name: "Create edition" })).toHaveCount(0);
  expect((await pv.request.put("/v1/admin/ai", { data: { enabled: true } })).status()).toBe(403);
  expect((await pv.request.get("/v1/admin/members")).status()).toBe(403);
  await ctxV.close();

  // the owner's changes are in the activity log
  await page.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByTestId("audit").first()).toBeVisible();
  await expect(page.getByTestId("audit").filter({ hasText: "set the role of" })).toHaveCount(1);
});
