import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const baseUrl = process.env.UI_REVIEW_BASE_URL ?? "http://127.0.0.1:3314";
const outputDir = path.resolve(process.cwd(), "ui-review-screenshots");

fs.mkdirSync(outputDir, { recursive: true });

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
    if (message.type() === "error") {
      diagnostics.consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error: Error) => {
    diagnostics.pageErrors.push(error.message);
  });
  page.on("requestfailed", (request: { method: () => string; url: () => string; failure: () => { errorText?: string } | null }) => {
    const failure = request.failure();
    if (failure?.errorText === "net::ERR_ABORTED") {
      return;
    }
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
  viewport: { width: 1440, height: 1400 },
});

test("desktop route and CTA flows", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);

  await page.goto(`${baseUrl}/SMO/overview`);
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Command K/i }).click();
  await expect(page.getByPlaceholder("Search issues, agents, projects...")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Search issues, agents, projects...")).toHaveCount(0);

  await page.getByRole("button", { name: "New Issue", exact: true }).click();
  await expect(page.getByPlaceholder("Issue title")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Issue title")).toHaveCount(0);

  await page.getByRole("link", { name: /Open work queue/i }).click();
  await expect(page).toHaveURL(/\/SMO\/work$/);
  await expect(page.getByRole("heading", { name: "Work", exact: true })).toBeVisible();

  await page.getByRole("link", { name: /Smoke protocol issue/i }).first().click();
  await expect(page).toHaveURL(/\/SMO\/work\/SMO-1$/);
  await expect(page.getByText("Smoke protocol issue").first()).toBeVisible();

  await page.goto(`${baseUrl}/SMO/overview`);
  await page.getByRole("link", { name: /Open runtime board/i }).click();
  await expect(page).toHaveURL(/\/SMO\/runs$/);
  await expect(page.getByRole("heading", { name: "Runs", exact: true })).toBeVisible();

  await page.goto(`${baseUrl}/SMO/changes`);
  await expect(page.getByRole("heading", { name: "Changes", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Inspect linked work/i }).click();
  await expect(page).toHaveURL(/\/SMO\/work\/SMO-1$/);

  await page.goto(`${baseUrl}/SMO/changes`);
  await page.getByRole("link", { name: /Open review/i }).first().click();
  await expect(page).toHaveURL(/\/SMO\/changes\/SMO-1$/);
  await expect(page.getByText("Smoke protocol issue").first()).toBeVisible();

  await page.goto(`${baseUrl}/SMO/runs`);
  await page.getByRole("link", { name: /Open work/i }).click();
  await expect(page).toHaveURL(/\/SMO\/work\/.+$/);
  await expect(page.getByText("Smoke protocol issue").first()).toBeVisible();
  await page.goto(`${baseUrl}/SMO/runs`);
  await page.getByRole("link", { name: /Run detail/i }).first().click();
  await expect(page).toHaveURL(/\/SMO\/agents\/.*\/runs\/.*/);
  await expect(page.getByText("Smoke Engineer").first()).toBeVisible();

  await page.goto(`${baseUrl}/SMO/team`);
  await page.getByRole("link", { name: "Open agents", exact: true }).click();
  await expect(page).toHaveURL(/\/SMO\/agents\/all$/);
  await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();

  await page.goto(`${baseUrl}/SMO/team`);
  await page.getByRole("link", { name: "Org chart", exact: true }).click();
  await expect(page).toHaveURL(/\/SMO\/org$/);
  await expect(page.getByText("Smoke Engineer").first()).toBeVisible();

  await page.goto(`${baseUrl}/SMO/knowledge`);
  await expect(page.getByRole("heading", { name: "Knowledge Base", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Refresh/i }).click();
  await expect(page.getByRole("button", { name: /Refresh/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Export/i })).toBeDisabled();

  await page.screenshot({ path: path.join(outputDir, "qa-desktop-route-review.png"), fullPage: true });
  expectHealthyDiagnostics(diagnostics);
});

test("add company onboarding opens and closes with updated shell", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);

  await page.goto(`${baseUrl}/SMO/overview`);
  await page.getByRole("button", { name: /Add company/i }).click();

  await expect(page.getByRole("heading", { name: "Create the operating company", exact: true })).toBeVisible();
  await expect(page.getByText("Studio setup").first()).toBeVisible();
  await expect(page.getByLabel("Close setup")).toBeVisible();
  await expect(page.getByText("Company identity", { exact: true })).toBeVisible();
  await expect(page.getByText("What gets created now", { exact: true })).toBeVisible();

  await page.screenshot({ path: path.join(outputDir, "qa-add-company-onboarding.png"), fullPage: true });

  await page.getByLabel("Close setup").click();
  await expect(page.getByRole("heading", { name: "Create the operating company", exact: true })).toHaveCount(0);
  expectHealthyDiagnostics(diagnostics);
});

test("mobile bottom nav stays usable", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page);

  await page.goto(`${baseUrl}/SMO/overview`);
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();

  const mobileNav = page.getByLabel("Mobile navigation");

  await mobileNav.getByRole("link", { name: "Work", exact: true }).click();
  await expect(page).toHaveURL(/\/SMO\/work$/);
  await expect(page.getByRole("heading", { name: "Work", exact: true })).toBeVisible();

  await mobileNav.getByRole("link", { name: "Runs", exact: true }).click();
  await expect(page).toHaveURL(/\/SMO\/runs$/);
  await expect(page.getByRole("heading", { name: "Runs", exact: true })).toBeVisible();

  await page.screenshot({ path: path.join(outputDir, "qa-mobile-nav-review.png"), fullPage: true });
  expectHealthyDiagnostics(diagnostics);
  await context.close();
});

test("dark mode surfaces stay readable", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);

  await page.goto(`${baseUrl}/SMO/overview`);
  await page.getByRole("button", { name: /Switch to dark mode/i }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(outputDir, "qa-dark-overview-review.png"), fullPage: true });

  await page.goto(`${baseUrl}/SMO/knowledge`);
  await expect(page.getByRole("heading", { name: "Knowledge Base", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(outputDir, "qa-dark-knowledge-review.png"), fullPage: true });

  await page.goto(`${baseUrl}/SMO/runs`);
  await expect(page.getByRole("heading", { name: "Runs", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(outputDir, "qa-dark-runs-review.png"), fullPage: true });

  expectHealthyDiagnostics(diagnostics);
});
