import { execFile, execFileSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const SCRIPT_PATH = path.resolve(process.cwd(), "scripts/runtime/squadrail-protocol.mjs");
const execFileAsync = promisify(execFile);

function buildEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SQUADRAIL_API_URL: "http://127.0.0.1:3103",
    SQUADRAIL_API_KEY: "test-key",
    SQUADRAIL_AGENT_ID: "agent-123",
    SQUADRAIL_COMPANY_ID: "company-123",
    SQUADRAIL_TASK_ID: "issue-123",
  };
}

async function closeTestServer(server: http.Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

describe("squadrail protocol helper CLI", () => {
  it("prints reassign-task help without requiring operational flags", () => {
    const stdout = execFileSync("node", [SCRIPT_PATH, "reassign-task", "--help"], {
      env: buildEnv(),
      encoding: "utf8",
    });

    expect(stdout).toContain("Usage: squadrail-protocol.mjs reassign-task");
    expect(stdout).toContain("--assignee-id");
    expect(stdout).toContain("--payload <json>");
  });

  it("prints targeted help through the top-level help command", () => {
    const stdout = execFileSync("node", [SCRIPT_PATH, "help", "reassign-task"], {
      env: buildEnv(),
      encoding: "utf8",
    });

    expect(stdout).toContain("Supported options:");
    expect(stdout).toContain("newAssigneeAgentId");
  });

  it("prints ack-assignment help without requiring sender-role", () => {
    const stdout = execFileSync("node", [SCRIPT_PATH, "ack-assignment", "--help"], {
      env: buildEnv(),
      encoding: "utf8",
    });

    expect(stdout).toContain("Usage: squadrail-protocol.mjs ack-assignment");
    expect(stdout).toContain("--understood-scope");
  });

  it("accepts camelCase ack-assignment aliases used by live TL loops", async () => {
    const requests: Array<{ path: string; body: unknown; headers: http.IncomingHttpHeaders }> = [];
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end("missing url");
        return;
      }

      if (req.method === "GET" && req.url === "/api/issues/issue-123/protocol/state") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ workflowState: "assigned", currentReviewCycle: 0 }));
        return;
      }

      if (req.method === "GET" && req.url === "/api/companies/company-123/agents") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify([{ id: "agent-123", role: "tech_lead", title: "Tech Lead" }]));
        return;
      }

      if (req.method === "POST" && req.url === "/api/issues/issue-123/protocol/messages") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          requests.push({
            path: req.url ?? "",
            body: JSON.parse(raw),
            headers: req.headers,
          });
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      res.statusCode = 404;
      res.end("not found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("failed to bind test server");
    }

    try {
      const { stdout } = await execFileAsync(
        "node",
        [
          SCRIPT_PATH,
          "ack-assignment",
          "--issue",
          "issue-123",
          "--understoodScope",
          "Route the fix to engineering after confirming TL ownership.",
          "--initialRisks",
          "QA handoff still pending||Needs explicit reviewer loop",
        ],
        {
          env: {
            ...buildEnv(),
            SQUADRAIL_API_URL: `http://127.0.0.1:${address.port}`,
          },
          encoding: "utf8",
          timeout: 10_000,
        },
      );

      expect(stdout).toContain('"ok": true');
      expect(requests).toHaveLength(1);
      const payload = requests[0]?.body as Record<string, unknown>;
      expect(payload.summary).toBe("Route the fix to engineering after confirming TL ownership.");
      expect(payload.workflowStateAfter).toBe("accepted");
      expect(payload.payload).toMatchObject({
        accepted: true,
        understoodScope: "Route the fix to engineering after confirming TL ownership.",
        initialRisks: [
          "QA handoff still pending",
          "Needs explicit reviewer loop",
        ],
      });
    } finally {
      await closeTestServer(server);
    }
  });

  it("accepts camelCase close-task aliases used by live agents", async () => {
    const requests: Array<{ path: string; body: unknown; headers: http.IncomingHttpHeaders }> = [];
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end("missing url");
        return;
      }

      if (req.method === "GET" && req.url === "/api/issues/issue-123/protocol/state") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ workflowState: "approved", currentReviewCycle: 1 }));
        return;
      }

      if (req.method === "GET" && req.url === "/api/companies/company-123/agents") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify([{ id: "agent-123", role: "tech_lead", title: "Tech Lead" }]));
        return;
      }

      if (req.method === "POST" && req.url === "/api/issues/issue-123/protocol/messages") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          requests.push({
            path: req.url ?? "",
            body: JSON.parse(raw),
            headers: req.headers,
          });
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      res.statusCode = 404;
      res.end("not found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("failed to bind test server");
    }

    try {
      const { stdout } = await execFileAsync(
        "node",
        [
          SCRIPT_PATH,
          "close-task",
          "--issue",
          "issue-123",
          "--closureSummary",
          "Closed through automation",
          "--verificationSummary",
          "Verified in isolated workspace",
          "--rollbackPlan",
          "Revert merge candidate",
          "--finalArtifacts",
          "diff||test_run",
          "--finalTestStatus",
          "all green",
          "--mergeStatus",
          "pending_external_merge",
          "--closeReason",
          "completed",
          "--remainingRisks",
          "Needs maintainer merge",
        ],
        {
          env: {
            ...buildEnv(),
            SQUADRAIL_API_URL: `http://127.0.0.1:${address.port}`,
          },
          encoding: "utf8",
          timeout: 10_000,
        },
      );

      expect(stdout).toContain('"ok": true');
      expect(requests).toHaveLength(1);
      const payload = requests[0]?.body as Record<string, unknown>;
      expect(payload.summary).toBe("Closed through automation");
      expect(payload.workflowStateAfter).toBe("done");
      expect(payload.payload).toMatchObject({
        closeReason: "completed",
        mergeStatus: "pending_external_merge",
        closureSummary: "Closed through automation",
        verificationSummary: "Verified in isolated workspace",
        rollbackPlan: "Revert merge candidate",
        finalTestStatus: "all green",
        remainingRisks: ["Needs maintainer merge"],
      });
    } finally {
      await closeTestServer(server);
    }
  });

  it("accepts payload-only start-review requests used by live reviewers", async () => {
    const requests: Array<{ path: string; body: unknown; headers: http.IncomingHttpHeaders }> = [];
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end("missing url");
        return;
      }

      if (req.method === "GET" && req.url === "/api/issues/issue-123/protocol/state") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ workflowState: "submitted_for_review", currentReviewCycle: 0 }));
        return;
      }

      if (req.method === "GET" && req.url === "/api/companies/company-123/agents") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify([{ id: "agent-123", role: "qa", title: "QA Lead" }]));
        return;
      }

      if (req.method === "POST" && req.url === "/api/issues/issue-123/protocol/messages") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          requests.push({
            path: req.url ?? "",
            body: JSON.parse(raw),
            headers: req.headers,
          });
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      res.statusCode = 404;
      res.end("not found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("failed to bind test server");
    }

    try {
      const { stdout } = await execFileAsync(
        "node",
        [
          SCRIPT_PATH,
          "start-review",
          "--issue",
          "issue-123",
          "--payload",
          JSON.stringify({
            reviewCycle: 1,
            reviewFocus: [
              "Verify build-info service version resolution",
              "Confirm fallback remains deterministic",
            ],
            blockingReview: true,
          }),
        ],
        {
          env: {
            ...buildEnv(),
            SQUADRAIL_API_URL: `http://127.0.0.1:${address.port}`,
          },
          encoding: "utf8",
          timeout: 10_000,
        },
      );

      expect(stdout).toContain('"ok": true');
      expect(requests).toHaveLength(1);
      const payload = requests[0]?.body as Record<string, unknown>;
      expect(payload.summary).toBe("Start review for Verify build-info service version resolution");
      expect(payload.workflowStateAfter).toBe("under_review");
      expect(payload.payload).toMatchObject({
        reviewCycle: 1,
        reviewFocus: [
          "Verify build-info service version resolution",
          "Confirm fallback remains deterministic",
        ],
        blockingReview: true,
      });
    } finally {
      await closeTestServer(server);
    }
  });

  it("preserves empty string option values instead of coercing them to true", async () => {
    const requests: Array<{ path: string; body: unknown; headers: http.IncomingHttpHeaders }> = [];
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end("missing url");
        return;
      }

      if (req.method === "GET" && req.url === "/api/issues/issue-123/protocol/state") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ workflowState: "implementing", currentReviewCycle: 0 }));
        return;
      }

      if (req.method === "GET" && req.url === "/api/companies/company-123/agents") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify([{ id: "agent-123", role: "engineer", title: "Engineer" }]));
        return;
      }

      if (req.method === "POST" && req.url === "/api/issues/issue-123/protocol/messages") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          requests.push({
            path: req.url ?? "",
            body: JSON.parse(raw),
            headers: req.headers,
          });
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      res.statusCode = 404;
      res.end("not found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("failed to bind test server");
    }

    try {
      const { stdout } = await execFileAsync(
        "node",
        [
          SCRIPT_PATH,
          "report-progress",
          "--issue",
          "issue-123",
          "--summary",
          "Progress update",
          "--progress-percent",
          "5",
          "--changed-files",
          "",
          "--test-summary",
          "No tests run yet",
        ],
        {
          env: {
            ...buildEnv(),
            SQUADRAIL_API_URL: `http://127.0.0.1:${address.port}`,
          },
          encoding: "utf8",
          timeout: 10_000,
        },
      );

      expect(stdout).toContain('"ok": true');
      expect(requests).toHaveLength(1);
      const payload = requests[0]?.body as Record<string, unknown>;
      expect(payload.payload).toMatchObject({
        progressPercent: 5,
        changedFiles: [],
        testSummary: "No tests run yet",
      });
    } finally {
      await closeTestServer(server);
    }
  });

  it("accepts payload-only approve-implementation requests with camelCase keys", async () => {
    const requests: Array<{ path: string; body: unknown; headers: http.IncomingHttpHeaders }> = [];
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end("missing url");
        return;
      }

      if (req.method === "GET" && req.url === "/api/issues/issue-123/protocol/state") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ workflowState: "under_review", currentReviewCycle: 1 }));
        return;
      }

      if (req.method === "GET" && req.url === "/api/companies/company-123/agents") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify([{ id: "agent-123", role: "qa", title: "QA Lead" }]));
        return;
      }

      if (req.method === "POST" && req.url === "/api/issues/issue-123/protocol/messages") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          requests.push({
            path: req.url ?? "",
            body: JSON.parse(raw),
            headers: req.headers,
          });
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      res.statusCode = 404;
      res.end("not found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("failed to bind test server");
    }

    try {
      const { stdout } = await execFileAsync(
        "node",
        [
          SCRIPT_PATH,
          "approve-implementation",
          "--issue",
          "issue-123",
          "--payload",
          JSON.stringify({
            approvalMode: "qa_review",
            approvalSummary: "Evidence and tests satisfy the QA review bar.",
            approvalChecklist: [
              "Acceptance criteria verified",
              "Regression scope reviewed",
            ],
            verifiedEvidence: [
              "go test ./internal/observability -count=1",
              "Diff limited to tracing package",
            ],
            residualRisks: [
              "Maintainer still needs to merge the change",
            ],
          }),
        ],
        {
          env: {
            ...buildEnv(),
            SQUADRAIL_API_URL: `http://127.0.0.1:${address.port}`,
          },
          encoding: "utf8",
          timeout: 10_000,
        },
      );

      expect(stdout).toContain('"ok": true');
      expect(requests).toHaveLength(1);
      const payload = requests[0]?.body as Record<string, unknown>;
      expect(payload.summary).toBe("Evidence and tests satisfy the QA review bar.");
      expect(payload.workflowStateAfter).toBe("approved");
      expect(payload.payload).toMatchObject({
        approvalMode: "agent_review",
        approvalSummary: "Evidence and tests satisfy the QA review bar.",
        approvalChecklist: [
          "Acceptance criteria verified",
          "Regression scope reviewed",
        ],
        verifiedEvidence: [
          "go test ./internal/observability -count=1",
          "Diff limited to tracing package",
        ],
        residualRisks: [
          "Maintainer still needs to merge the change",
        ],
      });
    } finally {
      await closeTestServer(server);
    }
  });

  it("normalizes legacy full approval mode aliases before sending approve-implementation", async () => {
    const requests: Array<{ path: string; body: unknown; headers: Record<string, unknown> }> = [];
    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/api/issues/issue-123/protocol/state") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
          workflowState: "under_review",
          assigneeAgentId: "eng-1",
          reviewerAgentId: "rev-1",
        }));
        return;
      }
      if (req.method === "GET" && req.url === "/api/companies/company-123/agents") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify([
          { id: "agent-123", role: "qa", title: "QA Lead", urlKey: "qa-lead" },
        ]));
        return;
      }
      if (req.method === "POST" && req.url === "/api/issues/issue-123/protocol/messages") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          requests.push({
            path: req.url ?? "",
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            headers: req.headers,
          });
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("failed to bind test server");
    }

    try {
      const { stdout } = await execFileAsync(
        "node",
        [
          SCRIPT_PATH,
          "approve-implementation",
          "--issue",
          "issue-123",
          "--payload",
          JSON.stringify({
            approvalMode: "full",
            approvalSummary: "Legacy alias should be normalized.",
            approvalChecklist: ["Reviewed change"],
            verifiedEvidence: ["go test ./pkg/swiftcl -count=1"],
            residualRisks: ["External merge remains pending"],
          }),
        ],
        {
          env: {
            ...buildEnv(),
            SQUADRAIL_API_URL: `http://127.0.0.1:${address.port}`,
          },
          encoding: "utf8",
          timeout: 10_000,
        },
      );

      expect(stdout).toContain("\"ok\": true");
      expect(requests).toHaveLength(1);
      const payload = requests[0]?.body as Record<string, unknown>;
      expect(payload.payload).toMatchObject({
        approvalMode: "agent_review",
        approvalSummary: "Legacy alias should be normalized.",
      });
    } finally {
      await closeTestServer(server);
    }
  });
});
