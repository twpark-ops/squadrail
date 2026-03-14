import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const baseUrl = process.env.UI_REVIEW_BASE_URL ?? "http://127.0.0.1:3326";
const repoRoot = process.cwd();

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
  const companyName = `Blueprint Smoke Org ${Date.now()}`;

  await page.goto(`${baseUrl}/SMO/overview`);
  await page.getByRole("button", { name: /Add company/i }).click();
  await expect(
    page.getByRole("heading", {
      name: "Create the operating company",
      exact: true,
    })
  ).toBeVisible();
  await page.getByLabel("Company name").fill(companyName);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  const companyPrefix = new URL(page.url()).pathname.split("/").filter(Boolean)[0];
  if (!companyPrefix) {
    throw new Error("failed to resolve company prefix after company creation");
  }

  await page.goto(`${baseUrl}/${companyPrefix}/settings`);
  await expect(page.getByRole("heading", { name: "Company Settings", exact: true })).toBeVisible();
  await expect(page.getByText("Setup progress").first()).toBeVisible();
  await page.getByLabel("Project slots").fill("2");
  await page.getByRole("button", { name: "Preview team plan", exact: true }).click();
  await expect(page.getByText("Preview diff").first()).toBeVisible();
  await expect(page.getByText("2 project slot(s), 1 engineer pair(s)").first()).toBeVisible();
  await page
    .getByLabel("I reviewed this preview diff and want to apply the current team blueprint to this company.")
    .check();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Apply team blueprint", exact: true }).click();
  await expect(page.getByText("Blueprint applied").first()).toBeVisible();
  await expect(page.getByText("Import blueprint bundle").first()).toBeVisible();
  await expect(page.getByText("Saved blueprint library").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Export JSON", exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("failed to resolve downloaded blueprint bundle path");
  }
  const bundleText = await readFile(downloadPath, "utf8");
  await page
    .getByPlaceholder('{"schemaVersion":1,"source":{...},"definition":{...}}')
    .fill(bundleText);
  await page.getByRole("button", { name: "Preview import", exact: true }).click();
  await expect(page.getByText("Import preview").first()).toBeVisible();
  await page
    .getByLabel("I reviewed the import preview and want to save this blueprint into the company library.")
    .check();
  await page.getByRole("button", { name: "Save to library", exact: true }).click();
  await expect(page.getByText("small-delivery-team").first()).toBeVisible();
  await page.getByRole("button", { name: "Preview saved blueprint", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply saved blueprint", exact: true })).toBeVisible();

  await page.goto(`${baseUrl}/${companyPrefix}/agents/all`);
  await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
  await expect(page.getByText("Live execution")).toBeVisible();

  await page.goto(`${baseUrl}/${companyPrefix}/projects`);
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Project directory", exact: true })).toBeVisible();

  await page.goto(`${baseUrl}/${companyPrefix}/goals`);
  await expect(page.getByRole("heading", { name: "Goals", exact: true })).toBeVisible();
  await expect(page.getByText(/Goal tree|No goals have been defined yet\./).first()).toBeVisible();

  await page.goto(`${baseUrl}/${companyPrefix}/approvals/pending`);
  await expect(page.getByRole("heading", { name: "Approvals", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Approval queue", exact: true })).toBeVisible();

  await page.goto(`${baseUrl}/${companyPrefix}/activity`);
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Activity stream", exact: true })).toBeVisible();

  await page.goto(`${baseUrl}/${companyPrefix}/inbox/new`);
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inbox queue", exact: true })).toBeVisible();

  await page.goto(`${baseUrl}/${companyPrefix}/costs`);
  await expect(page.getByRole("heading", { name: "Costs", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cost range", exact: true })).toBeVisible();

  await page.goto(`${baseUrl}/${companyPrefix}/analytics`);
  await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Available now", exact: true })).toBeVisible();

  await page.goto(`${baseUrl}/${companyPrefix}/org`);
  await expect(page.getByRole("heading", { name: "Org Chart", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Interactive organization map", exact: true })).toBeVisible();

  expectHealthyDiagnostics(diagnostics);
});

test("onboarding wizard completes blueprint to quick-request happy path", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const diagnostics = attachDiagnostics(page);
  const companyName = `Onboarding Blueprint Smoke ${Date.now()}`;
  const quickRequestTitle = "Onboarding smoke request";
  const quickRequestBody =
    "Stand up the initial delivery team, connect the primary workspace, and capture the first intake request.";

  await page.goto(`${baseUrl}/SMO/overview`);
  await page.getByRole("button", { name: /Add company/i }).click();
  await expect(
    page.getByRole("heading", {
      name: "Create the operating company",
      exact: true,
    }),
  ).toBeVisible();

  await page.getByLabel("Company name").fill(companyName);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(
    page.getByRole("heading", {
      name: "Select the starting team blueprint",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeDisabled();

  await page
    .getByRole("button")
    .filter({ hasText: "Standard Product Squad" })
    .click();
  await page.getByLabel("Project slots").fill("3");
  await page.getByLabel("Engineer pair(s) per project").fill("2");
  await page.getByRole("button", { name: "Preview blueprint", exact: true }).click();
  await expect(page.getByText("Preview diff").first()).toBeVisible();
  await expect(page.getByText("3 project slot(s), 2 engineer pair(s)").first()).toBeVisible();
  await page
    .getByLabel("I reviewed this preview diff and want to apply the current team blueprint to this company.")
    .check();
  await page.getByRole("button", { name: "Apply team blueprint", exact: true }).click();
  await expect(page.getByText("Team blueprint applied").first()).toBeVisible();

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Connect the primary execution workspace",
      exact: true,
    }),
  ).toBeVisible();

  const projectSelect = page.locator('label:has-text("Project") + select');
  await expect(projectSelect).toBeVisible();
  await expect
    .poll(async () => projectSelect.locator("option").count(), {
      message: "expected onboarding project select to load blueprint-backed project options",
    })
    .toBeGreaterThan(1);
  if ((await projectSelect.inputValue()) === "") {
    const firstProjectValue = await projectSelect
      .locator("option")
      .nth(1)
      .getAttribute("value");
    if (!firstProjectValue) {
      throw new Error("onboarding project select did not expose a real project option");
    }
    await projectSelect.selectOption(firstProjectValue);
  }

  const workspaceTargetSelect = page.locator(
    'label:has-text("Workspace target") + select',
  );
  await expect(workspaceTargetSelect).toBeVisible();
  if ((await workspaceTargetSelect.inputValue()) !== "__new__") {
    await workspaceTargetSelect.selectOption("__new__");
  }

  const workspacePathInput = page.getByPlaceholder("/path/to/project");
  await expect(workspacePathInput).toBeVisible();
  await workspacePathInput.fill(repoRoot);
  await expect(workspacePathInput).toHaveValue(repoRoot);
  const workspaceRepoUrlInput = page.getByPlaceholder("https://github.com/org/repo");
  await expect(workspaceRepoUrlInput).toBeVisible();
  await workspaceRepoUrlInput.fill("https://example.com/onboarding-blueprint-smoke.git");
  await expect(workspaceRepoUrlInput).toHaveValue(
    "https://example.com/onboarding-blueprint-smoke.git",
  );
  const envProbeResponse = page.waitForResponse((response) => {
    const url = response.url();
    return (
      response.request().method() === "POST" &&
      response.status() === 200 &&
      url.includes("/api/companies/") &&
      url.includes("/adapters/claude_local/test-environment")
    );
  });
  const workspaceCreateResponse = page.waitForResponse((response) => {
    const url = response.url();
    return (
      response.request().method() === "POST" &&
      response.status() === 201 &&
      url.includes("/api/projects/") &&
      url.includes("/workspaces")
    );
  });
  const setupProgressPatchResponse = page.waitForResponse((response) => {
    const url = response.url();
    return (
      response.request().method() === "PATCH" &&
      response.status() === 200 &&
      url.includes("/api/companies/") &&
      url.includes("/setup-progress")
    );
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await Promise.all([
    envProbeResponse,
    workspaceCreateResponse,
    setupProgressPatchResponse,
  ]);

  await expect(
    page.getByRole("heading", {
      name: "Launch the first quick request",
      exact: true,
    }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByPlaceholder("Optional: concise operating title").fill(quickRequestTitle);
  await page
    .getByPlaceholder("Describe the goal, why it matters, and any obvious constraints.")
    .fill(quickRequestBody);
  const quickRequestResponse = page.waitForResponse((response) => {
    const url = response.url();
    return (
      response.request().method() === "POST" &&
      response.status() === 201 &&
      url.includes("/api/companies/") &&
      url.includes("/intake/issues")
    );
  });
  await page.getByRole("button", { name: "Create quick request", exact: true }).click();
  await quickRequestResponse;

  await page.waitForURL(/\/[^/]+\/work\/[^/]+$/);
  await expect(page.getByText(quickRequestTitle).first()).toBeVisible();

  expectHealthyDiagnostics(diagnostics);
});
