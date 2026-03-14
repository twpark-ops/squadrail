import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const SCRIPT_PATH = fileURLToPath(new URL("../../../scripts/runtime/squadrail-protocol.mjs", import.meta.url));
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

async function createGitRepo(): Promise<string> {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), "squadrail-protocol-helper-"));
  execFileSync("git", ["init"], { cwd: repoDir, encoding: "utf8" });
  execFileSync("git", ["config", "user.name", "Squadrail Test"], { cwd: repoDir, encoding: "utf8" });
  execFileSync("git", ["config", "user.email", "test@squadrail.local"], { cwd: repoDir, encoding: "utf8" });
  await writeFile(path.join(repoDir, "README.md"), "# helper repo\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoDir, encoding: "utf8" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir, encoding: "utf8" });
  return repoDir;
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

  it("lists company projects for PM routing helpers", async () => {
    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/api/companies/company-123/projects") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify([
          { id: "project-1", name: "swiftsight-cloud" },
        ]));
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
      const { stdout } = await execFileAsync("node", [SCRIPT_PATH, "list-projects"], {
        env: {
          ...buildEnv(),
          SQUADRAIL_API_URL: `http://127.0.0.1:${address.port}`,
        },
        encoding: "utf8",
        timeout: 10_000,
      });

      expect(stdout).toContain("swiftsight-cloud");
    } finally {
      await closeTestServer(server);
    }
  });

  it("previews PM intake projection drafts through the helper command", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/issues/issue-123/intake/projection-preview") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          requests.push({
            path: req.url ?? "",
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          });
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            issueId: "issue-123",
            draft: { reason: "Route to TL lane", workItems: [] },
          }));
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
          "preview-intake-projection",
          "--issue",
          "issue-123",
          "--project-id",
          "project-1",
          "--coordination-only",
          "false",
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

      expect(stdout).toContain("Route to TL lane");
      expect(requests).toHaveLength(1);
      expect(requests[0]?.body).toEqual({
        projectId: "project-1",
        coordinationOnly: false,
      });
    } finally {
      await closeTestServer(server);
    }
  });

  it("applies PM intake projection drafts from preview-json", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/issues/issue-123/intake/projection") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          requests.push({
            path: req.url ?? "",
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
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
      const previewJson = JSON.stringify({
        draft: {
          reason: "Route to TL lane",
          techLeadAgentId: "tl-1",
          reviewerAgentId: "reviewer-1",
          qaAgentId: null,
          coordinationOnly: false,
          root: {
            executionSummary: "summary",
            acceptanceCriteria: ["one"],
            definitionOfDone: ["done"],
          },
          workItems: [],
        },
      });

      const { stdout } = await execFileAsync(
        "node",
        [
          SCRIPT_PATH,
          "apply-intake-projection",
          "--issue",
          "issue-123",
          "--preview-json",
          previewJson,
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
      expect(requests[0]?.body).toMatchObject({
        reason: "Route to TL lane",
        techLeadAgentId: "tl-1",
        reviewerAgentId: "reviewer-1",
      });
    } finally {
      await closeTestServer(server);
    }
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

  it("posts blocking clarification requests for human-board follow-up", async () => {
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
        res.end(JSON.stringify([{ id: "agent-123", role: "engineer", title: "Engineer" }]));
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
          "ask-clarification",
          "--issue",
          "issue-123",
          "--question-type",
          "requirement",
          "--question",
          "Should this stay scoped to the cloud export handoff only?",
          "--resume-workflow-state",
          "implementing",
          "--proposed-assumptions",
          "Keep the change in the cloud lane only||Focused verification is enough",
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
      expect(requests[0]?.body).toMatchObject({
        messageType: "ASK_CLARIFICATION",
        workflowStateBefore: "assigned",
        workflowStateAfter: "assigned",
        recipients: [
          {
            recipientType: "role_group",
            recipientId: "human_board",
            role: "human_board",
          },
        ],
        payload: {
          questionType: "requirement",
          question: "Should this stay scoped to the cloud export handoff only?",
          blocking: true,
          requestedFrom: "human_board",
          resumeWorkflowState: "implementing",
          proposedAssumptions: [
            "Keep the change in the cloud lane only",
            "Focused verification is enough",
          ],
        },
      });
    } finally {
      await closeTestServer(server);
    }
  });

  it("posts blocker escalations through the helper command", async () => {
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
          "escalate-blocker",
          "--issue",
          "issue-123",
          "--blocker-code",
          "needs_human_decision",
          "--blocking-reason",
          "Board confirmation is required before implementation continues.",
          "--requested-action",
          "Confirm the scope boundary and let implementation resume.",
          "--requested-from",
          "human_board",
          "--summary",
          "Escalate blocker for board clarification.",
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
      expect(requests[0]?.body).toMatchObject({
        messageType: "ESCALATE_BLOCKER",
        workflowStateBefore: "implementing",
        workflowStateAfter: "blocked",
        recipients: [
          {
            recipientType: "role_group",
            recipientId: "human_board",
            role: "human_board",
          },
        ],
        payload: {
          blockerCode: "needs_human_decision",
          blockingReason: "Board confirmation is required before implementation continues.",
          requestedAction: "Confirm the scope boundary and let implementation resume.",
          requestedFrom: "human_board",
        },
      });
    } finally {
      await closeTestServer(server);
    }
  });

  it("defaults TL-titled engineers to engineer sender-role for engineer-only commands", async () => {
    const requests: Array<{ path: string; body: unknown; headers: http.IncomingHttpHeaders }> = [];
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end("missing url");
        return;
      }

      if (req.method === "GET" && req.url === "/api/issues/issue-123/protocol/state") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
          workflowState: "accepted",
          techLeadAgentId: "agent-123",
          primaryEngineerAgentId: null,
          reviewerAgentId: "reviewer-123",
          qaAgentId: null,
          currentReviewCycle: 0,
        }));
        return;
      }

      if (req.method === "GET" && req.url === "/api/companies/company-123/agents") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify([
          { id: "agent-123", role: "engineer", title: "Tech Lead", urlKey: "swiftsight-cloud-tl" },
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
          "start-implementation",
          "--issue",
          "issue-123",
          "--summary",
          "TL starts implementation directly",
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
      expect(payload.sender).toMatchObject({
        actorType: "agent",
        actorId: "agent-123",
        role: "engineer",
      });
      expect(payload.recipients).toEqual([
        {
          recipientType: "agent",
          recipientId: "agent-123",
          role: "engineer",
        },
      ]);
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
        finalTestStatus: "passed",
        remainingRisks: ["Needs maintainer merge"],
      });
    } finally {
      await closeTestServer(server);
    }
  });

  it("defaults close-task to tech_lead when the same TL-titled engineer is also the reviewer", async () => {
    const requests: Array<{ path: string; body: unknown; headers: http.IncomingHttpHeaders }> = [];
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end("missing url");
        return;
      }

      if (req.method === "GET" && req.url === "/api/issues/issue-123/protocol/state") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
          workflowState: "approved",
          techLeadAgentId: "agent-123",
          reviewerAgentId: "agent-123",
          currentReviewCycle: 1,
        }));
        return;
      }

      if (req.method === "GET" && req.url === "/api/companies/company-123/agents") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify([
          { id: "agent-123", role: "engineer", title: "Tech Lead", urlKey: "swiftsight-cloud-tl" },
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
          "close-task",
          "--issue",
          "issue-123",
          "--closure-summary",
          "Closure recorded",
          "--verification-summary",
          "Approval already exists",
          "--rollback-plan",
          "Revert the focused patch",
          "--final-artifacts",
          "diff||approval",
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
      expect(payload.sender).toMatchObject({
        actorType: "agent",
        actorId: "agent-123",
        role: "tech_lead",
      });
      expect(payload.recipients).toEqual([
        {
          recipientType: "agent",
          recipientId: "agent-123",
          role: "tech_lead",
        },
      ]);
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
      expect(payload.workflowStateAfter).toBe("under_qa_review");
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

  it("only auto-attaches git artifacts on submit-for-review", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end("missing url");
        return;
      }

      if (req.method === "GET" && req.url === "/api/issues/issue-123/protocol/state") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ workflowState: "implementing", currentReviewCycle: 1 }));
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
          requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
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

    const repoDir = await createGitRepo();

    try {
      await execFileAsync(
        "node",
        [
          SCRIPT_PATH,
          "start-implementation",
          "--issue",
          "issue-123",
          "--summary",
          "Start implementation",
        ],
        {
          cwd: repoDir,
          env: {
            ...buildEnv(),
            SQUADRAIL_API_URL: `http://127.0.0.1:${address.port}`,
          },
          encoding: "utf8",
          timeout: 10_000,
        },
      );

      await execFileAsync(
        "node",
        [
          SCRIPT_PATH,
          "submit-for-review",
          "--issue",
          "issue-123",
          "--reviewer-id",
          "reviewer-123",
          "--summary",
          "Submit for review",
          "--implementation-summary",
          "Implementation summary",
          "--evidence",
          "Evidence A||Evidence B",
          "--diff-summary",
          "Updated the focused files",
          "--changed-files",
          "README.md",
          "--test-results",
          "pnpm test",
          "--review-checklist",
          "Checklist A||Checklist B",
          "--residual-risks",
          "Risk A",
        ],
        {
          cwd: repoDir,
          env: {
            ...buildEnv(),
            SQUADRAIL_API_URL: `http://127.0.0.1:${address.port}`,
          },
          encoding: "utf8",
          timeout: 10_000,
        },
      );

      expect(requests).toHaveLength(2);
      expect(requests[0]?.messageType).toBe("START_IMPLEMENTATION");
      expect(requests[0]?.artifacts).toEqual([]);

      expect(requests[1]?.messageType).toBe("SUBMIT_FOR_REVIEW");
      expect(requests[1]?.artifacts).toEqual([
        expect.objectContaining({
          kind: "commit",
          metadata: expect.objectContaining({
            changedFiles: ["README.md"],
            captureConfidence: "local_git_helper",
          }),
        }),
      ]);
    } finally {
      await closeTestServer(server);
    }
  });
});
