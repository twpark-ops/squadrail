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

  it("creates projects with an initial workspace and records activity", async () => {
    mockCreateProject.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
      name: "Runtime",
    });
    mockCreateWorkspace.mockResolvedValue({
      id: "workspace-1",
      projectId: "project-1",
      name: "Primary",
      cwd: "/repo/runtime",
      isPrimary: true,
    });
    mockGetProjectById.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
      name: "Runtime",
      workspaces: [{ id: "workspace-1" }],
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

    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({
      id: "project-1",
      workspaces: [{ id: "workspace-1" }],
    }));
    expect(mockLogActivity).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        action: "project.created",
        entityId: "project-1",
        details: expect.objectContaining({
          workspaceId: "workspace-1",
        }),
      }),
    );
  });

  it("lists, creates, updates, and deletes project workspaces", async () => {
    mockGetProjectById.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
      name: "Runtime",
    });
    mockListWorkspaces.mockResolvedValue([
      {
        id: "workspace-1",
        projectId: "project-1",
        name: "Primary",
        cwd: "/repo/runtime",
        isPrimary: true,
      },
    ]);
    mockCreateWorkspace.mockResolvedValue({
      id: "workspace-2",
      projectId: "project-1",
      name: "QA",
      cwd: "/repo/runtime-qa",
      isPrimary: false,
    });
    mockUpdateWorkspace.mockResolvedValue({
      id: "workspace-1",
      projectId: "project-1",
      name: "Primary",
      cwd: "/repo/runtime-main",
      isPrimary: true,
    });
    mockRemoveWorkspace.mockResolvedValue({
      id: "workspace-1",
      projectId: "project-1",
      name: "Primary",
      cwd: "/repo/runtime-main",
      isPrimary: true,
    });
    const app = createApp();

    const listed = await request(app).get("/projects/project-1/workspaces");
    const created = await request(app)
      .post("/projects/project-1/workspaces")
      .send({
        name: "QA",
        cwd: "/repo/runtime-qa",
        isPrimary: false,
      });
    const updated = await request(app)
      .patch("/projects/project-1/workspaces/workspace-1")
      .send({
        cwd: "/repo/runtime-main",
      });
    const removed = await request(app).delete("/projects/project-1/workspaces/workspace-1");

    expect(listed.status).toBe(200);
    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(removed.status).toBe(200);
    expect(mockCreateWorkspace).toHaveBeenCalledWith("project-1", expect.objectContaining({
      name: "QA",
      cwd: "/repo/runtime-qa",
    }));
    expect(mockUpdateWorkspace).toHaveBeenCalledWith("project-1", "workspace-1", {
      cwd: "/repo/runtime-main",
    });
    expect(mockRemoveWorkspace).toHaveBeenCalledWith("project-1", "workspace-1");
  });

  it("updates and deletes projects", async () => {
    mockGetProjectById.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
      name: "Runtime",
    });
    mockUpdateProject.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
      name: "Runtime Core",
    });
    mockRemoveProject.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
      name: "Runtime Core",
    });
    const app = createApp();

    const updated = await request(app)
      .patch("/projects/project-1")
      .send({
        name: "Runtime Core",
      });
    const removed = await request(app).delete("/projects/project-1");

    expect(updated.status).toBe(200);
    expect(updated.body).toEqual(expect.objectContaining({
      id: "project-1",
      name: "Runtime Core",
    }));
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual(expect.objectContaining({
      id: "project-1",
      name: "Runtime Core",
    }));
    expect(mockUpdateProject).toHaveBeenCalledWith("project-1", { name: "Runtime Core" });
    expect(mockRemoveProject).toHaveBeenCalledWith("project-1");
  });
});
