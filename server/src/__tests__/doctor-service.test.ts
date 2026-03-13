import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { companies, issueProtocolMessages, projectWorkspaces } from "@squadrail/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindServerAdapter,
  mockIsPrimaryServerAdapter,
  mockProtocolIntegrityReady,
  mockSetupGetView,
  mockEmbeddingGetProviderInfo,
  mockRerankGetProviderInfo,
} = vi.hoisted(() => ({
  mockFindServerAdapter: vi.fn(),
  mockIsPrimaryServerAdapter: vi.fn(),
  mockProtocolIntegrityReady: vi.fn(),
  mockSetupGetView: vi.fn(),
  mockEmbeddingGetProviderInfo: vi.fn(),
  mockRerankGetProviderInfo: vi.fn(),
}));

vi.mock("../adapters/registry.js", () => ({
  findServerAdapter: mockFindServerAdapter,
  isPrimaryServerAdapter: mockIsPrimaryServerAdapter,
}));

vi.mock("../protocol-integrity.js", () => ({
  protocolIntegrityReady: mockProtocolIntegrityReady,
}));

vi.mock("../services/setup-progress.js", () => ({
  setupProgressService: () => ({
    getView: mockSetupGetView,
  }),
}));

vi.mock("../services/knowledge-embeddings.js", () => ({
  knowledgeEmbeddingService: () => ({
    getProviderInfo: mockEmbeddingGetProviderInfo,
  }),
}));

vi.mock("../services/knowledge-reranking.js", () => ({
  knowledgeRerankingService: () => ({
    getProviderInfo: mockRerankGetProviderInfo,
  }),
}));

import { doctorService } from "../services/doctor.js";

function shiftTableRows(queueMap: Map<unknown, unknown[][]>, table: unknown) {
  const queue = queueMap.get(table);
  return queue?.shift() ?? [];
}

function createResolvedSelectChain(selectRows: Map<unknown, unknown[][]>) {
  let selectedTable: unknown = null;
  const chain = {
    from: (table: unknown) => {
      selectedTable = table;
      return chain;
    },
    where: () => chain,
    leftJoin: () => chain,
    orderBy: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(shiftTableRows(selectRows, selectedTable)).then(resolve),
  };
  return chain;
}

function createDoctorDbMock(input?: {
  selectRows?: Map<unknown, unknown[][]>;
  executeRows?: Array<unknown[] | Error>;
}) {
  const selectRows = input?.selectRows ?? new Map();
  const executeRows = [...(input?.executeRows ?? [])];
  return {
    db: {
      select: () => createResolvedSelectChain(selectRows),
      execute: async () => {
        const next = executeRows.shift();
        if (next instanceof Error) throw next;
        return next ?? [];
      },
    },
  };
}

describe("doctor service", () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "doctor-service-"));
    mockSetupGetView.mockResolvedValue({
      companyId: "company-1",
      status: "engine_ready",
      selectedEngine: "codex_local",
      selectedWorkspaceId: "workspace-1",
      metadata: {},
      steps: {
        companyReady: true,
        squadReady: true,
        engineReady: true,
        workspaceConnected: true,
        knowledgeSeeded: false,
        firstIssueReady: false,
      },
    });
    mockEmbeddingGetProviderInfo.mockReturnValue({
      available: true,
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
    });
    mockRerankGetProviderInfo.mockReturnValue({
      available: true,
      provider: "voyage",
      model: "rerank-2",
    });
    mockProtocolIntegrityReady.mockReturnValue(true);
    mockIsPrimaryServerAdapter.mockReturnValue(true);
    mockFindServerAdapter.mockReturnValue({
      testEnvironment: vi.fn().mockResolvedValue({
        ok: true,
        checks: [
          {
            code: "cli_ready",
            level: "info",
            message: "CLI is ready.",
          },
        ],
      }),
    });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("builds a passing deep doctor report when workspace and providers are healthy", async () => {
    const workspaceDir = path.join(tempRoot, "runtime");
    await fs.mkdir(workspaceDir, { recursive: true });
    const { db } = createDoctorDbMock({
      selectRows: new Map([
        [projectWorkspaces, [[{
          workspaceId: "workspace-1",
          projectId: "project-1",
          projectName: "Runtime",
          workspaceName: "runtime",
          cwd: workspaceDir,
          repoUrl: "https://github.com/acme/runtime",
          isPrimary: true,
        }]]],
        [companies, [[{ id: "company-1" }]]],
        [issueProtocolMessages, [[{ count: 0 }]]],
      ]),
      executeRows: [
        [{ ok: 1 }],
        [{ installed: true }],
        [{ installed: true }],
        [{ enabled: true, role_ready: true }],
      ],
    });
    const service = doctorService(db as never, {
      deploymentMode: "authenticated",
      deploymentExposure: "public",
      authReady: true,
      protocolTimeoutsEnabled: true,
      knowledgeBackfillEnabled: true,
    });

    const report = await service.run({
      companyId: "company-1",
      deep: true,
    });

    expect(report.status).toBe("pass");
    expect(report.workspace).toMatchObject({
      workspaceId: "workspace-1",
      cwd: workspaceDir,
    });
    expect(report.summary.fail).toBe(0);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "workspace_access", status: "pass" }),
        expect.objectContaining({ code: "embedding_provider", status: "pass" }),
        expect.objectContaining({ code: "rerank_provider", status: "pass" }),
        expect.objectContaining({ code: "codex_local_cli_ready", status: "pass" }),
      ]),
    );
  });

  it("reports failures and warnings when auth, database, integrity, and workspace readiness are incomplete", async () => {
    mockSetupGetView.mockResolvedValue({
      companyId: "company-1",
      status: "company_ready",
      selectedEngine: null,
      selectedWorkspaceId: null,
      metadata: {},
      steps: {
        companyReady: true,
        squadReady: false,
        engineReady: false,
        workspaceConnected: false,
        knowledgeSeeded: false,
        firstIssueReady: false,
      },
    });
    mockEmbeddingGetProviderInfo.mockReturnValue({
      available: false,
      provider: null,
      model: null,
      dimensions: 0,
    });
    mockRerankGetProviderInfo.mockReturnValue({
      available: false,
      provider: null,
      model: null,
    });
    mockProtocolIntegrityReady.mockReturnValue(false);
    const { db } = createDoctorDbMock({
      selectRows: new Map([
        [projectWorkspaces, [[{
          workspaceId: "workspace-2",
          projectId: "project-2",
          projectName: "Docs",
          workspaceName: "docs",
          cwd: null,
          repoUrl: "https://github.com/acme/docs",
          isPrimary: true,
        }]]],
        [companies, [[]]],
        [issueProtocolMessages, [[{ count: 5 }]]],
      ]),
      executeRows: [
        new Error("database offline"),
        [{ installed: false }],
        [],
        [{ enabled: false, role_ready: false }],
      ],
    });
    const service = doctorService(db as never, {
      deploymentMode: "authenticated",
      deploymentExposure: "public",
      authReady: false,
      protocolTimeoutsEnabled: false,
      knowledgeBackfillEnabled: false,
    });

    const report = await service.run({
      companyId: "company-1",
      deep: false,
    });

    expect(report.status).toBe("fail");
    expect(report.summary.fail).toBeGreaterThan(0);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "company_exists", status: "fail" }),
        expect.objectContaining({ code: "database_connection", status: "fail" }),
        expect.objectContaining({ code: "protocol_integrity_secret", status: "warn" }),
        expect.objectContaining({ code: "workspace_access", status: "warn" }),
        expect.objectContaining({ code: "embedding_provider", status: "warn" }),
      ]),
    );
  });
});
