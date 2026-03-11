import { expect, test } from "@playwright/test";

const baseUrl = process.env.UI_REVIEW_BASE_URL ?? "http://127.0.0.1:3326";

type BrowserDiagnostics = {
  consoleErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
  badResponses: string[];
};

function attachDiagnostics(page: { on: (event: string, listener: (...args: any[]) => void) => void }): BrowserDiagnostics {
  const diagnostics: BrowserDiagnostics = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    badResponses: [],
  };

  page.on("console", (message: { type: () => string; text: () => string }) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error: Error) => {
    diagnostics.pageErrors.push(error.message);
  });
  page.on("requestfailed", (request: { method: () => string; url: () => string; failure: () => { errorText?: string } | null }) => {
    const failure = request.failure();
    if (failure?.errorText === "net::ERR_ABORTED") return;
    diagnostics.requestFailures.push(`${request.method()} ${request.url()} :: ${failure?.errorText ?? "unknown failure"}`);
  });
  page.on("response", (response: { status: () => number; url: () => string; request: () => { method: () => string } }) => {
    if (response.status() >= 400) {
      diagnostics.badResponses.push(`${response.request().method()} ${response.url()} :: ${response.status()}`);
    }
  });

  return diagnostics;
}

function expectHealthyDiagnostics(diagnostics: BrowserDiagnostics): void {
  expect(diagnostics.consoleErrors, "console errors").toEqual([]);
  expect(diagnostics.pageErrors, "page errors").toEqual([]);
  expect(diagnostics.requestFailures, "request failures").toEqual([]);
  expect(diagnostics.badResponses, "bad responses").toEqual([]);
}

test.describe.configure({ mode: "serial" });
test.use({
  channel: "chrome",
  viewport: { width: 1440, height: 1280 },
});

test("support routes render with updated UI-only surfaces", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);

  await page.goto(`${baseUrl}/SMO/companies`);
  await expect(page.getByRole("heading", { name: "Companies", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Company directory", exact: true })).toBeVisible();

  await page.goto(`${baseUrl}/SMO/settings`);
  await expect(page.getByRole("heading", { name: "Company Settings", exact: true })).toBeVisible();
  await expect(page.getByText("Setup progress").first()).toBeVisible();

  await page.goto(`${baseUrl}/SMO/agents/all`);
  await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
  await expect(page.getByText("Live execution")).toBeVisible();
  await page.getByRole("link", { name: /Smoke Engineer/i }).first().click();
  await expect(page.getByRole("heading", { name: "Smoke Engineer", exact: true })).toBeVisible();
  await expect(page.getByText("Agent Surface")).toBeVisible();

  await page.goto(`${baseUrl}/SMO/projects`);
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Project directory", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Smoke Workspace/i }).first().click();
  await expect(page.getByRole("heading", { name: "Smoke Workspace", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Project workspace", exact: true })).toBeVisible();

  await page.goto(`${baseUrl}/SMO/goals`);
  await expect(page.getByRole("heading", { name: "Goals", exact: true })).toBeVisible();
  await expect(page.getByText(/Goal tree|No goals have been defined yet\./).first()).toBeVisible();

  await page.goto(`${baseUrl}/SMO/approvals/pending`);
  await expect(page.getByRole("heading", { name: "Approvals", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Approval queue", exact: true })).toBeVisible();

  await page.goto(`${baseUrl}/SMO/activity`);
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Activity stream", exact: true })).toBeVisible();

  await page.goto(`${baseUrl}/SMO/inbox/new`);
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inbox queue", exact: true })).toBeVisible();

  await page.goto(`${baseUrl}/SMO/costs`);
  await expect(page.getByRole("heading", { name: "Costs", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cost range", exact: true })).toBeVisible();

  await page.goto(`${baseUrl}/SMO/analytics`);
  await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Available now", exact: true })).toBeVisible();

  await page.goto(`${baseUrl}/SMO/org`);
  await expect(page.getByRole("heading", { name: "Org Chart", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Interactive organization map", exact: true })).toBeVisible();

  expectHealthyDiagnostics(diagnostics);
});
