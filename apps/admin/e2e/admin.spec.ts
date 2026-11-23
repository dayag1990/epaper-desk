import { expect, test, type Page } from "@playwright/test";

const MOCK = "http://127.0.0.1:8171";
const ADMIN = "/admin/";

test.beforeEach(async ({ request }) => { await request.get(`${MOCK}/__reset`); });

async function login(page: Page, who: "owner" | "editor" | "viewer") {
  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(`${who}@desk.test`);
  await page.getByLabel("Password").fill(`${who}-pass-123`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("role")).toHaveText(who);
}

test("login: wrong password says so in plain words, right one gets in, sign out returns", async ({ page }) => {
  await page.goto(ADMIN);
  await page.getByLabel("Email").fill("owner@desk.test");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("That email and password do not match.");
  await page.getByLabel("Password").fill("owner-pass-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("role")).toHaveText("owner");
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("role")).toHaveText("owner"); // the cookie keeps the session
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("form", { name: "Sign in" })).toBeVisible();
});

test("add a source with the wizard: find, confidence, 5-story test, save, sync", async ({ page }) => {
  await login(page, "editor");
  await page.getByRole("link", { name: "Sources" }).click();
  await page.getByRole("button", { name: "Add a source" }).click();
  await page.getByLabel("Website address").fill("https://nowhere.test");
  await page.getByRole("button", { name: "Find the stories" }).click();
  await expect(page.getByRole("alert")).toContainText("could not open that address");
  await page.getByLabel("Website address").fill("https://news.example");
  await page.getByRole("button", { name: "Find the stories" }).click();
  await expect(page.getByTestId("confidence")).toContainText("Good match (86%)");
  await expect(page.getByTestId("samples").locator("li")).toHaveCount(3);
  await page.getByRole("button", { name: "Save this source" }).click();
  const src = page.getByTestId("source");
  await expect(src).toHaveCount(1);
  await expect(src).toContainText("Nothing fetched yet");
  await src.getByRole("button", { name: "Sync now" }).click();
  await expect(src).toContainText("Working. Last fetch: 3 new");
  // edit the rules and test them
  await src.getByRole("button", { name: "Edit rules" }).click();
  await page.getByRole("button", { name: "Test with 5 stories (saved rules)" }).click();
  await expect(page.getByTestId("samples")).toBeVisible();
  await page.getByLabel("Rule for headline").fill("h1.title");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByLabel("Rule for headline")).toHaveCount(0);
  // destructive: asks first
  await src.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Remove");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(src).toHaveCount(1);
});

test("create an edition, auto-plan, approve, export, publish, roll back", async ({ page }) => {
  await login(page, "owner");
  await page.getByRole("button", { name: "Create edition" }).click();
  const detail = page.getByTestId("edition-detail");
  await expect(detail.getByTestId("next-step")).toContainText("Auto-plan");
  await detail.getByRole("button", { name: "Auto-plan" }).click();
  await expect(detail.getByTestId("page")).toHaveCount(4, { timeout: 15_000 });
  await expect(detail.getByTestId("page").nth(0)).toContainText("92% full");
  await expect(detail.getByTestId("page").nth(2)).toContainText("too much text");
  await expect(detail.getByRole("link", { name: "Open in the editor" })).toHaveAttribute("href", /\/\?edition=e1$/);
  await expect(detail.getByRole("button", { name: /IDML.*not available yet/ })).toBeDisabled();
  await detail.getByRole("button", { name: "Approve all pages" }).click();
  await page.getByRole("button", { name: "Approve all", exact: true }).click();
  await expect(detail.getByTestId("next-step")).toContainText("Make the PDF");
  await detail.getByRole("button", { name: "Make PDF" }).click();
  await expect(detail.getByTestId("reader-status")).toContainText("Ready to publish", { timeout: 15_000 });
  await detail.getByRole("button", { name: "Publish to readers" }).click();
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(detail.getByTestId("reader-status")).toContainText("Live for readers");
  await detail.getByRole("button", { name: "Roll back" }).click();
  await page.getByRole("button", { name: "Roll back", exact: true }).last().click();
  await expect(detail.getByTestId("reader-status")).toContainText("Ready to publish");
  // every destructive step is in the activity log
  await page.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByTestId("audit").first()).toContainText("rolled back");
});

test("a viewer sees everything read-only and no admin screens", async ({ page }) => {
  await login(page, "viewer");
  await expect(page.getByText("You can look around, but not change anything")).toBeVisible();
  for (const name of ["People", "Connections", "Activity", "Settings"]) await expect(page.getByRole("link", { name })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create edition" })).toHaveCount(0);
  await page.getByRole("link", { name: "Sources" }).click();
  await expect(page.getByRole("button", { name: "Add a source" })).toHaveCount(0);
  await page.getByRole("link", { name: "Articles" }).click();
  await page.getByTestId("article").first().getByRole("button").click();
  await expect(page.getByTestId("article-detail")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
  // typing the owner-only address by hand lands back on a screen the role may see
  await page.goto(`${ADMIN}#/settings`);
  await expect(page.getByRole("heading", { name: "Editions" })).toBeVisible();
  // and the server itself refuses
  const r = await page.request.put("/v1/admin/ai", { data: { enabled: true } });
  expect(r.status()).toBe(403);
});

test("articles: search, hide with confirmation, bring back", async ({ page }) => {
  await login(page, "editor");
  await page.getByRole("link", { name: "Articles" }).click();
  await expect(page.getByTestId("article")).toHaveCount(3);
  await page.getByLabel("Search headlines").fill("flood");
  await expect(page.getByTestId("article")).toHaveCount(1);
  await page.getByTestId("article").getByRole("button").first().click();
  await page.getByLabel(/Priority/).fill("90");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Hide it" }).click();
  await expect(page.getByTestId("article")).toHaveCount(0);
  await page.getByLabel("Show").selectOption("yes");
  await expect(page.getByTestId("article")).toHaveCount(1);
});

test("owner: AI is off and disabled without a key; works with a key; people, keys, webhooks", async ({ page, request }) => {
  await login(page, "owner");
  await page.getByRole("link", { name: "Settings" }).click();
  const sw = page.getByRole("switch", { name: "AI help" });
  await expect(sw).toBeDisabled();
  await expect(sw).not.toBeChecked();
  await expect(page.getByTestId("ai-reason")).toContainText("No AI key");
  // the rest of the console works with AI off
  await page.getByRole("link", { name: "Sources" }).click();
  await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
  await request.get(`${MOCK}/__ai?key=1`);
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(sw).toBeEnabled();
  await expect(sw).not.toBeChecked();
  await sw.click();
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByTestId("ai-state")).toContainText("AI help is on");
  await sw.click();
  await expect(page.getByTestId("ai-state")).toContainText("AI help is off");

  await page.getByRole("link", { name: "People" }).click();
  await expect(page.getByTestId("member")).toHaveCount(3);
  await page.getByRole("button", { name: "Remove" }).first().click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("member")).toHaveCount(3);

  // a source, a key shown once, a webhook with test and log
  await page.getByRole("link", { name: "Sources" }).click();
  await page.getByRole("button", { name: "Add a source" }).click();
  await page.getByLabel("Website address").fill("https://news.example");
  await page.getByRole("button", { name: "Find the stories" }).click();
  await page.getByRole("button", { name: "Save this source" }).click();
  await page.getByRole("link", { name: "Connections" }).click();
  await page.getByLabel("Source").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Make a key" }).click();
  await expect(page.getByTestId("secret")).toContainText("epk_");
  await page.getByRole("button", { name: "I have copied it" }).click();
  await expect(page.getByTestId("secret")).toHaveCount(0);
  await expect(page.getByTestId("key")).toHaveCount(1);
  await page.getByLabel("Address to call").fill("https://example.com/hook");
  await page.getByRole("button", { name: "Add webhook" }).click();
  await expect(page.getByTestId("secret")).toContainText("whsec_");
  await page.getByRole("button", { name: "I have copied it" }).click();
  await page.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByTestId("deliveries")).toContainText("test · Delivered");
});

test("phone width: no sideways scroll on the main screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await login(page, "owner");
  for (const s of ["Editions", "Articles", "Sources", "People", "Connections", "Activity", "Settings"]) {
    await page.getByRole("link", { name: s, exact: true }).click();
    await expect(page.getByRole("heading", { name: s, exact: true })).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${s} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});
