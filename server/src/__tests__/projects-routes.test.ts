import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockListProjects,
  mockGetProjectById,
  mockResolveProjectByReference,
  mockCreateProject,
  mockCreateWorkspace,
  mockRemoveProject,
  mockUpdateProject,
  mockListWorkspaces,
  mockUpdateWorkspace,
  mockRemoveWorkspace,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockListProjects: vi.fn(),
  mockGetProjectById: vi.fn(),
  mockResolveProjectByReference: vi.fn(),
  mockCreateProject: vi.fn(),
  mockCreateWorkspace: vi.fn(),
  mockRemoveProject: vi.fn(),
  mockUpdateProject: vi.fn(),
  mockListWorkspaces: vi.fn(),
  mockUpdateWorkspace: vi.fn(),
  mockRemoveWorkspace: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  logActivity: mockLogActivity,
  projectService: () => ({
    list: mockListProjects,
    getById: mockGetProjectById,
    resolveByReference: mockResolveProjectByReference,
    create: mockCreateProject,
    createWorkspace: mockCreateWorkspace,
    remove: mockRemoveProject,
    update: mockUpdateProject,
    listWorkspaces: mockListWorkspaces,
    updateWorkspace: mockUpdateWorkspace,
    removeWorkspace: mockRemoveWorkspace,
  }),
}));

import { projectRoutes } from "../routes/projects.js";

function buildBoardActor() {
  return {
    type: "board" as const,
    source: "local_implicit" as const,
    isInstanceAdmin: true,
    userId: "user-1",
    companyIds: ["company-1"],
    runId: null,
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = buildBoardActor();
    next();
  });
  app.use(projectRoutes({} as never));
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Unhandled error" });
  });
  return app;
}

describe("project routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists company projects", async () => {
    mockListProjects.mockResolvedValue([
      {
        id: "project-1",
        companyId: "company-1",
        name: "Runtime",
      },
    ]);
    const app = createApp();

    const response = await request(app).get("/companies/company-1/projects");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: "project-1",
        companyId: "company-1",
        name: "Runtime",
      }),
    ]);
    expect(mockListProjects).toHaveBeenCalledWith("company-1");
  });

  it("normalizes short project references through company scope", async () => {
    mockResolveProjectByReference.mockResolvedValue({
      ambiguous: false,
      project: { id: "project-1" },
    });
    mockGetProjectById.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
      name: "Runtime",
    });
    const app = createApp();

    const response = await request(app).get("/projects/runtime").query({ companyId: "company-1" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: "project-1",
      companyId: "company-1",
      name: "Runtime",
    });
    expect(mockResolveProjectByReference).toHaveBeenCalledWith("company-1", "runtime");
    expect(mockGetProjectById).toHaveBeenCalledWith("project-1");
  });

  it("rejects ambiguous short project references", async () => {
    mockResolveProjectByReference.mockResolvedValue({
      ambiguous: true,
      project: null,
    });
    const app = createApp();

    const response = await request(app).get("/projects/runtime").query({ companyId: "company-1" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "Project shortname is ambiguous in this company. Use the project ID.",
    });
  });

  it("rolls back project creation when workspace payload cannot be persisted", async () => {
    mockCreateProject.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
      name: "Runtime",
    });
    mockCreateWorkspace.mockResolvedValue(null);
    mockRemoveProject.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
    });
    const app = createApp();

    const response = await request(app)
      .post("/companies/company-1/projects")
      .send({
        name: "Runtime",
        description: "Runtime coordination",
        workspace: {
          name: "Primary",
          cwd: "/repo/runtime",
          isPrimary: true,
        },
      });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error: "Invalid project workspace payload",
    });
    expect(mockCreateProject).toHaveBeenCalledWith("company-1", expect.objectContaining({
      name: "Runtime",
    }));
    expect(mockCreateWorkspace).toHaveBeenCalledWith("project-1", expect.objectContaining({
      name: "Primary",
      cwd: "/repo/runtime",
    }));
    expect(mockRemoveProject).toHaveBeenCalledWith("project-1");
  });

  it("returns 404 when updating a workspace that is not attached to the project", async () => {
    mockResolveProjectByReference.mockResolvedValue({
      ambiguous: false,
      project: { id: "project-1" },
    });
    mockGetProjectById.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
      name: "Runtime",
    });
    mockListWorkspaces.mockResolvedValue([
      {
        id: "workspace-1",
        projectId: "project-1",
      },
    ]);
    const app = createApp();

    const response = await request(app)
      .patch("/projects/runtime/workspaces/workspace-missing")
      .query({ companyId: "company-1" })
      .send({
        cwd: "/repo/runtime",
      });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: "Project workspace not found",
    });
    expect(mockListWorkspaces).toHaveBeenCalledWith("project-1");
    expect(mockUpdateWorkspace).not.toHaveBeenCalled();
  });
});
