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

const editorAssetPattern = /\/assets\/(mdx-editor|lexical|markdown)-/i;

function attachDiagnostics(page: {
  on: (event: string, listener: (...args: any[]) => void) => void;
}): BrowserDiagnostics {
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
  page.on(
    "requestfailed",
    (request: {
      method: () => string;
      url: () => string;
      failure: () => { errorText?: string } | null;
    }) => {
      const failure = request.failure();
      if (failure?.errorText === "net::ERR_ABORTED") {
        return;
      }
      diagnostics.requestFailures.push(
        `${request.method()} ${request.url()} :: ${
          failure?.errorText ?? "unknown failure"
        }`
      );
    }
  );
  page.on(
    "response",
    (response: {
      status: () => number;
      url: () => string;
      request: () => { method: () => string };
    }) => {
      if (response.status() >= 400) {
        diagnostics.badResponses.push(
          `${response
            .request()
            .method()} ${response.url()} :: ${response.status()}`
        );
      }
    }
  );

  return diagnostics;
}

function expectHealthyDiagnostics(diagnostics: BrowserDiagnostics): void {
  expect(diagnostics.consoleErrors, "console errors").toEqual([]);
  expect(diagnostics.pageErrors, "page errors").toEqual([]);
  expect(diagnostics.requestFailures, "request failures").toEqual([]);
  expect(diagnostics.badResponses, "bad responses").toEqual([]);
}

function trackFinishedRequests(page: {
  on: (
    event: string,
    listener: (request: { url: () => string }) => void
  ) => void;
}): string[] {
  const finishedRequests: string[] = [];
  page.on("requestfinished", (request: { url: () => string }) => {
    finishedRequests.push(request.url());
  });
  return finishedRequests;
}

test.describe.configure({ mode: "serial" });
test.use({
  channel: "chrome",
  viewport: { width: 1440, height: 1400 },
});

test("desktop route and CTA flows", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);

  await page.goto(`${baseUrl}/SMO/overview`);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true })
  ).toBeVisible();
  await expect(page.getByText("Attention now").first()).toBeVisible();
  await expect(page.getByText("Knowledge coverage").first()).toBeVisible();
  await expect(page.getByText("Live operations").first()).toBeVisible();
  await page.getByRole("button", { name: /Reorder companies/i }).click();
  await expect(
    page.getByRole("button", { name: /Finish company order/i })
  ).toBeVisible();
  await page.getByRole("button", { name: /Finish company order/i }).click();
  await expect(
    page.getByRole("button", { name: /Reorder companies/i })
  ).toBeVisible();
  await page.getByRole("button", { name: /Command K/i }).click();
  await expect(
    page.getByPlaceholder("Search issues, agents, projects...")
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByPlaceholder("Search issues, agents, projects...")
  ).toHaveCount(0);

  await page.getByRole("button", { name: "New Issue", exact: true }).click();
  await expect(page.getByPlaceholder("Issue title")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Issue title")).toHaveCount(0);

  await page.getByRole("link", { name: /Open work queue/i }).click();
  await expect(page).toHaveURL(/\/SMO\/work$/);
  await expect(
    page.getByRole("heading", { name: "Work", exact: true })
  ).toBeVisible();

  await page
    .getByRole("link", { name: /Smoke protocol issue/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/SMO\/work\/SMO-1$/);
  await expect(page.getByText("Smoke protocol issue").first()).toBeVisible();

  await page.goto(`${baseUrl}/SMO/overview`);
  await page.getByRole("link", { name: /Open runtime board/i }).click();
  await expect(page).toHaveURL(/\/SMO\/runs$/);
  await expect(
    page.getByRole("heading", { name: "Runs", exact: true })
  ).toBeVisible();

  await page.goto(`${baseUrl}/SMO/changes`);
  await expect(
    page.getByText("Primary review desk").first()
  ).toBeVisible();
  await expect(page.getByText("Ready for review").first()).toBeVisible();
  await page.getByRole("link", { name: /Inspect linked work/i }).click();
  await expect(page).toHaveURL(/\/SMO\/work\/SMO-1$/);

  await page.goto(`${baseUrl}/SMO/changes`);
  await page
    .getByRole("link", { name: /Open review/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/SMO\/changes\/SMO-1$/);
  await expect(page.getByText("Smoke protocol issue").first()).toBeVisible();

  await page.goto(`${baseUrl}/SMO/runs`);
  await expect(
    page.getByRole("heading", { name: "Runs", exact: true })
  ).toBeVisible();
  await expect(page.getByText("Recovery Queue").first()).toBeVisible();
  await expect(page.getByText("Recent Heartbeats").first()).toBeVisible();

  await page.goto(`${baseUrl}/SMO/team`);
  await page.getByRole("link", { name: "Open agents", exact: true }).click();
  await expect(page).toHaveURL(/\/SMO\/agents\/all$/);
  await expect(
    page.getByRole("heading", { name: "Agents", exact: true })
  ).toBeVisible();

  await page.goto(`${baseUrl}/SMO/team`);
  await page.getByRole("link", { name: "Org chart", exact: true }).click();
  await expect(page).toHaveURL(/\/SMO\/org$/);
  await expect(page.getByText("Smoke Engineer").first()).toBeVisible();

  await page.goto(`${baseUrl}/SMO/knowledge`);
  await expect(
    page.getByRole("heading", { name: "Knowledge Base", exact: true })
  ).toBeVisible();
  await expect(page.getByText("Knowledge Map").first()).toBeVisible();
  await expect(page.getByText(/project nodes/i).first()).toBeVisible();
  await page.getByRole("button", { name: /Refresh/i }).click();
  await expect(page.getByRole("button", { name: /Refresh/i })).toBeVisible();

  await page.screenshot({
    path: path.join(outputDir, "qa-desktop-route-review.png"),
    fullPage: true,
  });
  expectHealthyDiagnostics(diagnostics);
});

test("overview first load does not pull markdown editor vendors", async ({
  page,
}) => {
  const diagnostics = attachDiagnostics(page);
  const finishedRequests = trackFinishedRequests(page);

  await page.goto(`${baseUrl}/SMO/overview`, { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true })
  ).toBeVisible();

  const initialEditorRequests = finishedRequests.filter((url) =>
    editorAssetPattern.test(url)
  );

  expect(
    initialEditorRequests,
    `Overview initial load should not request markdown editor vendors:\n${initialEditorRequests.join("\n")}`
  ).toEqual([]);
  expectHealthyDiagnostics(diagnostics);
});

test("company rail stored order persists after reload", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);

  await page.goto(`${baseUrl}/SMO/overview`);

  const companies = (await page.evaluate(async () => {
    const response = await fetch("/api/companies");
    return response.json();
  })) as Array<{ id: string; issuePrefix?: string }>;

  const smokeRecord = companies.find(
    (company) => company.issuePrefix === "SMO"
  );
  const secondaryRecord = companies.find(
    (company) => company.issuePrefix && company.issuePrefix !== "SMO"
  );
  if (!smokeRecord || !secondaryRecord?.issuePrefix) {
    throw new Error("Expected a secondary company in the company rail");
  }

  const smokeCompany = page.locator('a[href="/SMO/overview"]').first();
  const secondaryCompany = page
    .locator(`a[href="/${secondaryRecord.issuePrefix}/overview"]`)
    .first();

  await expect(smokeCompany).toBeVisible();
  await expect(secondaryCompany).toBeVisible();

  const smokeBefore = await smokeCompany.boundingBox();
  const secondaryBefore = await secondaryCompany.boundingBox();
  if (!smokeBefore || !secondaryBefore) {
    throw new Error("Company rail items were not measurable before drag");
  }

  expect(secondaryBefore.y).toBeGreaterThan(smokeBefore.y);

  await page.evaluate(
    ({ smokeId, secondaryId }) => {
      localStorage.setItem(
        "squadrail.companyOrder",
        JSON.stringify([secondaryId, smokeId])
      );
    },
    {
      smokeId: smokeRecord.id,
      secondaryId: secondaryRecord.id,
    }
  );
  await page.reload();

  await expect(smokeCompany).toBeVisible();
  await expect(secondaryCompany).toBeVisible();

  const smokeAfter = await smokeCompany.boundingBox();
  const secondaryAfter = await secondaryCompany.boundingBox();
  if (!smokeAfter || !secondaryAfter) {
    throw new Error("Company rail items were not measurable after reload");
  }

  expect(secondaryAfter.y).toBeLessThan(smokeAfter.y);
  expectHealthyDiagnostics(diagnostics);
});

test("add company onboarding opens and closes with updated shell", async ({
  page,
}) => {
  const diagnostics = attachDiagnostics(page);

  await page.goto(`${baseUrl}/SMO/overview`);
  await page.getByRole("button", { name: /Add company/i }).click();

  await expect(
    page.getByRole("heading", {
      name: "Create the operating company",
      exact: true,
    })
  ).toBeVisible();
  await expect(page.getByText("Studio setup").first()).toBeVisible();
  await expect(page.getByLabel("Close setup")).toBeVisible();
  await expect(
    page.getByText("Company identity", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("What this flow will do", { exact: true })
  ).toBeVisible();

  await page.getByLabel("Company name").fill("UI Review Org");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Select the starting team blueprint",
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preview blueprint", exact: true })
  ).toBeVisible();

  await page.screenshot({
    path: path.join(outputDir, "qa-add-company-onboarding.png"),
    fullPage: true,
  });

  await page.getByLabel("Close setup").click();
  await expect(
    page.getByRole("heading", {
      name: "Create the operating company",
      exact: true,
    })
  ).toHaveCount(0);
  expectHealthyDiagnostics(diagnostics);
});

test("change review desk and knowledge setup expose operator controls", async ({
  page,
}) => {
  const diagnostics = attachDiagnostics(page);

  await page.goto(`${baseUrl}/SMO/changes/SMO-1`);
  await expect(
    page.getByRole("heading", { name: "SMO-1 · Smoke protocol issue" })
  ).toBeVisible();
  await expect(page.getByText("Operator review desk").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mark merged", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mark rejected", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export patch", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export PR bundle", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Merge local", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Push branch", exact: true })
  ).toBeVisible();

  await page.goto(`${baseUrl}/SMO/knowledge`);
  await page.getByRole("tab", { name: "Setup", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Knowledge Setup", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sync selected", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sync all", exact: true })
  ).toBeVisible();
  await expect(page.getByText("Project sync matrix").first()).toBeVisible();
  await expect(page.getByText("Sync execution history").first()).toBeVisible();

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
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true })
  ).toBeVisible();

  const mobileNav = page.getByLabel("Mobile navigation");

  await mobileNav.getByRole("link", { name: "Work", exact: true }).click();
  await expect(page).toHaveURL(/\/SMO\/work$/);
  await expect(
    page.getByRole("heading", { name: "Work", exact: true })
  ).toBeVisible();

  await mobileNav.getByRole("link", { name: "Runs", exact: true }).click();
  await expect(page).toHaveURL(/\/SMO\/runs$/);
  await expect(
    page.getByRole("heading", { name: "Runs", exact: true })
  ).toBeVisible();

  await page.screenshot({
    path: path.join(outputDir, "qa-mobile-nav-review.png"),
    fullPage: true,
  });
  expectHealthyDiagnostics(diagnostics);
  await context.close();
});

test("dark mode surfaces stay readable", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);

  await page.goto(`${baseUrl}/SMO/overview`);
  await page.getByRole("button", { name: /Switch to dark mode/i }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true })
  ).toBeVisible();
  await page.screenshot({
    path: path.join(outputDir, "qa-dark-overview-review.png"),
    fullPage: true,
  });

  await page.goto(`${baseUrl}/SMO/knowledge`);
  await expect(
    page.getByRole("heading", { name: "Knowledge Base", exact: true })
  ).toBeVisible();
  await page.screenshot({
    path: path.join(outputDir, "qa-dark-knowledge-review.png"),
    fullPage: true,
  });

  await page.goto(`${baseUrl}/SMO/runs`);
  await expect(
    page.getByRole("heading", { name: "Runs", exact: true })
  ).toBeVisible();
  await page.screenshot({
    path: path.join(outputDir, "qa-dark-runs-review.png"),
    fullPage: true,
  });

  expectHealthyDiagnostics(diagnostics);
});
