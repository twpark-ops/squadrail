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

function isIgnorableBrowserNoise(message: string) {
  return message.includes("favicon.ico") || message === "Failed to load resource: the server responded with a status of 404 (Not Found)";
}

function isIgnorableBadResponse(url: string, status: number) {
  if (url.endsWith("/favicon.ico")) return true;
  // Live run log polling can observe a brief 404 before the log blob is materialized.
  if (status === 404 && /\/api\/heartbeat-runs\/[^/]+\/log\?/.test(url)) return true;
  return false;
}

function attachDiagnostics(page: { on: (event: string, listener: (...args: any[]) => void) => void }): BrowserDiagnostics {
  const diagnostics: BrowserDiagnostics = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    badResponses: [],
  };

  page.on("console", (message: { type: () => string; text: () => string }) => {
    if (message.type() === "error") {
      const text = message.text();
      if (isIgnorableBrowserNoise(text)) return;
      diagnostics.consoleErrors.push(text);
    }
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
      if (isIgnorableBadResponse(response.url(), response.status())) return;
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
  const companyPrefix = "SMO";

  await page.goto(`${baseUrl}/${companyPrefix}/settings`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Company Settings", exact: true })).toBeVisible({
    timeout: 15000,
  });
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
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Publish version", exact: true }).click();
  await expect(page.getByRole("button", { name: "Republish version", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Preview saved blueprint", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply saved blueprint", exact: true })).toBeVisible();
  await page
    .getByLabel("I reviewed this saved blueprint preview diff and want to apply it to this company.")
    .check();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Apply saved blueprint", exact: true }).click();
  await expect(page.getByText(/Applied preview hash/i).first()).toBeVisible();

  await page.goto(`${baseUrl}/${companyPrefix}/agents/all`);
  await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
  await expect(page.getByText("Live execution")).toBeVisible();

  await page.goto(`${baseUrl}/${companyPrefix}/overview`);
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.getByText(/No live execution right now|active or recent agent sessions/).first()).toBeVisible();

  await page.goto(`${baseUrl}/${companyPrefix}/team`);
  await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Squad Stage", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Stage", exact: true })).toBeVisible();
  await expect(page.getByTestId("squad-stage-scene-banner")).toBeVisible();
  await expect(page.getByTestId("squad-stage-scene-dispatch")).toBeVisible();
  await expect(page.getByTestId("squad-stage-priority-strip")).toBeVisible();
  await expect(page.getByText("Smoke Engineer").first()).toBeVisible();
  await expect(page.getByText("Parent issue progress").first()).toBeVisible();
  await expect(page.getByText("Office map").first()).toBeVisible();
  await expect(page.getByTestId("squad-stage-baton-planning-lead")).toBeVisible();
  await expect(page.getByTestId("squad-stage-station-build")).toBeVisible();
  await expect(page.getByTestId("squad-stage-room-build")).toBeVisible();
  await expect(page.getByTestId("squad-stage-map-room-build")).toBeVisible();
  await page.getByRole("tab", { name: "Roster", exact: true }).click();
  await expect(page.getByText("Leadership roster").first()).toBeVisible();
  await expect(page.getByText("Verification roster").first()).toBeVisible();

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

test("design guide keeps run transcript ahead of diagnostics", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);

  await page.goto(`${baseUrl}/SMO/design-guide`, {
    waitUntil: "networkidle",
  });

  await expect(page.getByRole("heading", { name: "Design Guide", exact: true })).toBeVisible();
  const fixture = page.getByTestId("design-guide-run-panel");
  await expect(fixture).toBeVisible();
  await expect(fixture.getByText(/Transcript \(\d+\)/).first()).toBeVisible();
  await expect(fixture.getByText("Diagnostics").first()).toBeVisible();
  await expect(
    fixture.getByText("I will patch the export handoff guard and add focused coverage.").first(),
  ).toBeVisible();

  const transcriptBeforeDiagnostics = await fixture.evaluate((element) => {
    const transcriptNode = Array.from(element.querySelectorAll("*")).find((node) =>
      /^Transcript \(\d+\)$/.test(node.textContent?.trim() ?? ""),
    );
    const diagnosticsNode = Array.from(element.querySelectorAll("*")).find(
      (node) => node.textContent?.trim() === "Diagnostics",
    );
    if (!(transcriptNode instanceof HTMLElement) || !(diagnosticsNode instanceof HTMLElement)) {
      return null;
    }
    return Boolean(
      transcriptNode.compareDocumentPosition(diagnosticsNode) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  expect(transcriptBeforeDiagnostics).toBe(true);

  await expect(
    fixture.getByText("You are the swiftsight cloud tech lead.").first(),
  ).not.toBeVisible();
  await fixture.getByRole("button", { name: /Prompt/i }).click();
  await expect(
    fixture.getByText("You are the swiftsight cloud tech lead.").first(),
  ).toBeVisible();
  await expect(fixture.getByText(/5 key\(s\) · \d redacted/).first()).toBeVisible();

  expectHealthyDiagnostics(diagnostics);
});

test("design guide groups linked live runs by lane", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);

  await page.goto(`${baseUrl}/SMO/design-guide`, {
    waitUntil: "networkidle",
  });

  const fixture = page.getByTestId("design-guide-live-run-widget-panel");
  await expect(fixture).toBeVisible();
  await expect(fixture.getByText("2 linked runs").first()).toBeVisible();
  await expect(
    fixture.getByText("Protocol gate and implementation follow-up are both attached to this lane.").first(),
  ).toBeVisible();
  await expect(fixture.getByText("Protocol gate").first()).toBeVisible();
  await expect(fixture.getByText("Implementation").first()).toBeVisible();
  await expect(
    fixture.getByText("Implementation follow-up queued in isolated workspace.").first(),
  ).toBeVisible();

  expectHealthyDiagnostics(diagnostics);
});

test("design guide prioritizes failed linked lanes over queued follow-ups", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);

  await page.goto(`${baseUrl}/SMO/design-guide`, {
    waitUntil: "networkidle",
  });

  const fixture = page.getByTestId("design-guide-live-run-widget-panel");
  const recoveryLane = fixture.locator(".live-run-cluster").filter({
    hasText: "Smoke Recovery Engineer",
  });

  await expect(recoveryLane).toBeVisible();
  await expect(recoveryLane.getByText("failed").first()).toBeVisible();
  await expect(
    fixture.getByText("Recovery follow-up is queued behind the failed protocol gate.").first(),
  ).toBeVisible();

  expectHealthyDiagnostics(diagnostics);
});

test("design guide shows delivery party blocked and qa state matrix", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);

  await page.goto(`${baseUrl}/SMO/design-guide`, {
    waitUntil: "networkidle",
  });

  const blockedFixture = page.getByTestId("design-guide-delivery-party-blocked");
  await expect(blockedFixture).toBeVisible();
  await expect(blockedFixture.getByText("Blocked here").first()).toBeVisible();
  await expect(blockedFixture.getByText("Acting as reviewer").first()).toBeVisible();
  await expect(blockedFixture.getByText("Waiting on diff").first()).toBeVisible();

  const qaFixture = page.getByTestId("design-guide-delivery-party-qa");
  await expect(qaFixture).toBeVisible();
  await expect(qaFixture.getByText("QA gate open").first()).toBeVisible();
  await expect(qaFixture.getByText("Verifying").first()).toBeVisible();

  expectHealthyDiagnostics(diagnostics);
});

test("design guide shows squad stage active and blocked state matrix", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);

  await page.goto(`${baseUrl}/SMO/design-guide`, {
    waitUntil: "networkidle",
  });

  const activeFixture = page.getByTestId("design-guide-squad-stage-active");
  await expect(activeFixture).toBeVisible();
  await expect(activeFixture.getByText("Smoke PM").first()).toBeVisible();
  await expect(activeFixture.getByText("Cloud TL").first()).toBeVisible();
  await expect(activeFixture.getByText("Smoke Engineer").first()).toBeVisible();
  await expect(activeFixture.getByText("Smoke Reviewer").first()).toBeVisible();
  await expect(activeFixture.getByText("Smoke QA Lead").first()).toBeVisible();
  await expect(activeFixture.getByText("Handing off").first()).toBeVisible();
  await expect(activeFixture.getByText("Implementing").first()).toBeVisible();
  await expect(activeFixture.getByText("Reviewing").first()).toBeVisible();
  await expect(activeFixture.getByText("Verifying").first()).toBeVisible();
  await expect(activeFixture.getByText("Focused diff in progress").first()).toBeVisible();
  await expect(activeFixture.getByTestId("squad-stage-baton-planning-lead")).toBeVisible();
  await expect(activeFixture.getByTestId("squad-stage-runner-planning-lead")).toBeVisible();
  await expect(activeFixture.getByTestId("squad-stage-scene-banner")).toBeVisible();
  await expect(activeFixture.getByTestId("squad-stage-scene-dispatch")).toBeVisible();
  await expect(activeFixture.getByTestId("squad-stage-priority-strip")).toBeVisible();
  await expect(activeFixture.getByTestId("squad-stage-station-review")).toBeVisible();
  await expect(activeFixture.getByTestId("squad-stage-room-review")).toBeVisible();
  await expect(activeFixture.getByTestId("squad-stage-packet-build")).toBeVisible();
  await expect(activeFixture.getByTestId("squad-stage-map-room-review")).toBeVisible();
  await expect(activeFixture.getByTestId("squad-stage-work-beam-build")).toBeVisible();
  await expect(activeFixture.getByTestId("squad-stage-work-beam-review")).toBeVisible();
  await expect(activeFixture.getByTestId("squad-stage-work-beam-qa")).toBeVisible();

  const activeMotionStyles = await activeFixture.evaluate((element) => {
    const actor = element.querySelector('[aria-label="Cloud TL · Handing off"]');
    const motion = actor?.querySelector(".squad-stage-actor__motion");
    const sprite = actor?.querySelector(".squad-stage-actor__sprite");
    const prop = actor?.querySelector(".squad-stage-actor__prop");
    const station = element.querySelector('[data-testid="squad-stage-station-review"] .squad-stage-station__sprite');
    const room = element.querySelector('[data-testid="squad-stage-room-review"]');
    const baton = element.querySelector('[data-testid="squad-stage-baton-planning-lead"] .squad-stage-flow-strip__baton');
    const runner = element.querySelector('[data-testid="squad-stage-runner-planning-lead"]');
    const buildBeam = element.querySelector('[data-testid="squad-stage-work-beam-build"]');
    const packet = element.querySelector('[data-testid="squad-stage-packet-build"] .squad-stage-packet');
    const mapRoom = element.querySelector('[data-testid="squad-stage-map-room-review"]');
    const banner = element.querySelector('[data-testid="squad-stage-scene-banner"]');
    const dispatch = element.querySelector('[data-testid="squad-stage-scene-dispatch"]');
    const priorityStrip = element.querySelector('[data-testid="squad-stage-priority-strip"]');
    if (
      !(motion instanceof HTMLElement)
      || !(sprite instanceof HTMLElement)
      || !(prop instanceof HTMLElement)
      || !(station instanceof HTMLElement)
      || !(room instanceof HTMLElement)
      || !(baton instanceof HTMLElement)
      || !(runner instanceof HTMLElement)
      || !(buildBeam instanceof HTMLElement)
      || !(packet instanceof HTMLElement)
      || !(mapRoom instanceof HTMLElement)
      || !(banner instanceof HTMLElement)
      || !(dispatch instanceof HTMLElement)
      || !(priorityStrip instanceof HTMLElement)
    ) {
      return null;
    }

    const motionStyle = window.getComputedStyle(motion);
    const spriteStyle = window.getComputedStyle(sprite);
    const propStyle = window.getComputedStyle(prop);
    const stationStyle = window.getComputedStyle(station);
    const roomStyle = window.getComputedStyle(room);
    const batonStyle = window.getComputedStyle(baton);
    const runnerStyle = window.getComputedStyle(runner);
    const buildBeamStyle = window.getComputedStyle(buildBeam);
    const packetStyle = window.getComputedStyle(packet);
    const mapRoomStyle = window.getComputedStyle(mapRoom);
    const bannerStyle = window.getComputedStyle(banner);
    const dispatchStyle = window.getComputedStyle(dispatch);
    const priorityStyle = window.getComputedStyle(priorityStrip);

    return {
      motionAnimation: motionStyle.animationName,
      spriteAnimation: spriteStyle.animationName,
      spriteBackground: spriteStyle.backgroundImage,
      propBackground: propStyle.backgroundImage,
      stationBackground: stationStyle.backgroundImage,
      roomBackground: roomStyle.backgroundImage,
      batonAnimation: batonStyle.animationName,
      runnerAnimation: runnerStyle.animationName,
      buildBeamAnimation: buildBeamStyle.animationName,
      packetAnimation: packetStyle.animationName,
      mapRoomBorder: mapRoomStyle.borderColor,
      bannerBackdrop: bannerStyle.backdropFilter,
      dispatchShadow: dispatchStyle.boxShadow,
      priorityDisplay: priorityStyle.display,
    };
  });
  expect(activeMotionStyles).not.toBeNull();
  expect(activeMotionStyles?.motionAnimation).toContain("squad-stage-actor-handoff");
  expect(activeMotionStyles?.spriteAnimation).toContain("squad-stage-sprite-strip-3");
  expect(activeMotionStyles?.spriteBackground).toContain("/squad-stage/actors/char_");
  expect(activeMotionStyles?.propBackground).toContain("/squad-stage/office/handoff-prop.svg");
  expect(activeMotionStyles?.stationBackground).toContain("/squad-stage/office/review-station.svg");
  expect(activeMotionStyles?.roomBackground).toContain("/squad-stage/office/review-room.svg");
  expect(activeMotionStyles?.batonAnimation).toContain("squad-stage-baton-travel");
  expect(activeMotionStyles?.runnerAnimation).toContain("squad-stage-runner-travel");
  expect(activeMotionStyles?.buildBeamAnimation).toContain("squad-stage-work-beam-pulse");
  expect(activeMotionStyles?.packetAnimation).toContain("squad-stage-packet-float");
  expect(activeMotionStyles?.mapRoomBorder).not.toBe("");
  expect(activeMotionStyles?.bannerBackdrop).toContain("blur");
  expect(activeMotionStyles?.dispatchShadow).not.toBe("none");
  expect(activeMotionStyles?.priorityDisplay).toBe("grid");

  const blockedFixture = page.getByTestId("design-guide-squad-stage-blocked");
  await expect(blockedFixture).toBeVisible();
  await expect(blockedFixture.getByText("Recovery Engineer").first()).toBeVisible();
  await expect(blockedFixture.getByLabel("Queued Follow-up · Queued").first()).toBeVisible();
  await expect(blockedFixture.getByText("Blocked").first()).toBeVisible();
  await expect(blockedFixture.getByText("Fallback handoff armed").first()).toBeVisible();
  await expect(blockedFixture.getByText("SMO-302 blocked recovery").first()).toBeVisible();

  // Verify primaryActor=null lane still renders queued packets (regression guard)
  const planningLane = blockedFixture.locator('[data-lane="planning"]').first();
  const queuePacket = blockedFixture.getByText("SMO-410").first();
  const noActorLabel = blockedFixture.getByText("No active actor").first();
  // Planning lane has no primaryActor but has queued work — both must be visible
  if (await planningLane.count() > 0) {
    await expect(noActorLabel).toBeVisible();
    await expect(queuePacket).toBeVisible();
  }

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

test("saved blueprint library supports local authoring, versioning, and lifecycle actions", async ({ page, request }) => {
  test.setTimeout(90_000);
  const diagnostics = attachDiagnostics(page);
  const companyName = `Blueprint Library Smoke ${Date.now()}`;

  const createResponse = await request.post(`${baseUrl}/api/companies`, {
    data: { name: companyName },
  });
  expect(createResponse.ok()).toBeTruthy();
  const createdCompany = await createResponse.json() as { issuePrefix?: string | null };
  const companyPrefix = createdCompany.issuePrefix?.trim() ?? "";
  if (!companyPrefix) throw new Error("failed to resolve company prefix from company create response");

  await page.goto(`${baseUrl}/${companyPrefix}/settings`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Company Settings", exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Preview team plan", exact: true }).click();
  await expect(page.getByText("Preview diff").first()).toBeVisible();

  const savePreviewCard = page.locator("div.rounded-md").filter({
    has: page.getByText("Save preview to company library", { exact: true }),
  }).first();
  await savePreviewCard.getByRole("textbox").nth(0).fill("Saved Small Delivery Team");
  await savePreviewCard.getByRole("textbox").nth(1).fill("saved-small-delivery-team");
  await savePreviewCard.getByRole("textbox").nth(2).fill("Reusable compact delivery defaults for smoke validation.");
  await savePreviewCard.getByRole("textbox").nth(3).fill("Initial company-local baseline");
  await savePreviewCard.getByRole("button", { name: "Save to library", exact: true }).first().click();
  await expect(page.getByText("Saved Small Delivery Team").first()).toBeVisible();

  const savedLibraryPane = page.locator("div.rounded-md").filter({
    has: page.getByText("Saved blueprint library", { exact: true }),
  }).first();
  await savedLibraryPane.locator('input[value="Saved Small Delivery Team"]').last().fill("Saved Small Delivery Team Base");
  await savedLibraryPane.locator('input[value="saved-small-delivery-team"]').last().fill("saved-small-delivery-team-base");
  await savedLibraryPane.getByRole("button", { name: "Save library details", exact: true }).click();
  await expect(page.getByText("Saved Small Delivery Team Base").first()).toBeVisible();

  const savedExportDownload = page.waitForEvent("download");
  await savedLibraryPane.getByRole("button", { name: "Re-export JSON", exact: true }).click();
  const savedBundle = await savedExportDownload;
  const savedBundlePath = await savedBundle.path();
  if (!savedBundlePath) {
    throw new Error("failed to resolve saved blueprint export path");
  }
  const savedBundleText = await readFile(savedBundlePath, "utf8");
  expect(savedBundleText).toContain("saved-small-delivery-team-base");

  await savedLibraryPane.getByRole("button", { name: "Preview saved blueprint", exact: true }).click();
  const nextVersionCard = savedLibraryPane.locator("div.rounded-md").filter({
    has: page.getByText("Save preview as next version", { exact: true }),
  }).first();
  await expect(nextVersionCard.getByText("Save preview as next version", { exact: true })).toBeVisible();
  await nextVersionCard.getByRole("textbox").nth(0).fill("Saved Small Delivery Team Base v2");
  await nextVersionCard.getByRole("textbox").nth(1).fill("saved-small-delivery-team-v2");
  await nextVersionCard.getByRole("textbox").nth(3).fill("Increase saved engineer coverage");
  await nextVersionCard.getByRole("button", { name: "Save as next version", exact: true }).click();
  await expect(page.getByText("Saved blueprint preview was stored as the next company-local version.").first()).toBeVisible();
  const nextVersionButton = savedLibraryPane.getByRole("button").filter({ hasText: /v2 ·/ }).first();
  await expect(nextVersionButton).toBeVisible();
  await nextVersionButton.click();

  page.once("dialog", (dialog) => dialog.accept());
  await savedLibraryPane.getByRole("button", { name: "Delete from library", exact: true }).click();
  await expect(page.getByText("Saved blueprint deleted").first()).toBeVisible();

  expectHealthyDiagnostics(diagnostics);
});
