import { describe, expect, it } from "vitest";
import {
  ensureCompanyContext,
  resolveProject,
  resolveProjects,
} from "../company-bootstrap.mjs";

type StubValue = unknown | unknown[] | ((body: unknown) => unknown | Promise<unknown>);

function createApi(stubs: Record<string, StubValue>) {
  const calls: Array<{ key: string; body: unknown }> = [];
  const state = new Map(Object.entries(stubs));

  const api = async (pathname: string, options: { method?: string; body?: unknown } = {}) => {
    const method = options.method ?? "GET";
    const key = `${method} ${pathname}`;
    calls.push({ key, body: options.body });
    if (!state.has(key)) {
      throw new Error(`Unexpected API call: ${key}`);
    }

    const stub = state.get(key);
    if (Array.isArray(stub)) {
      if (stub.length === 0) {
        throw new Error(`Stub queue exhausted for ${key}`);
      }
      return stub.shift();
    }
    if (typeof stub === "function") {
      return stub(options.body);
    }
    return stub;
  };

  return { api, calls };
}

describe("company bootstrap helper", () => {
  it("reuses an existing company without preview/apply when enough projects already exist", async () => {
    const { api, calls } = createApi({
      "GET /api/companies": [
        [{ id: "company-1", name: "cloud-swiftsight", slug: "cloud-swiftsight" }],
      ],
      "GET /api/companies/company-1/projects": [
        [
          { id: "project-1", name: "swiftsight-cloud", urlKey: "swiftsight-cloud" },
          { id: "project-2", name: "swiftsight-agent", urlKey: "swiftsight-agent" },
        ],
      ],
    });

    const context = await ensureCompanyContext({
      api,
      name: "cloud-swiftsight",
      blueprintKey: "delivery_plus_qa",
      requiredProjectCount: 1,
    });

    expect(context).toEqual({
      company: { id: "company-1", name: "cloud-swiftsight", slug: "cloud-swiftsight" },
      bootstrapped: false,
      expanded: false,
      bootstrapProjectId: null,
      bootstrapProjectName: null,
    });
    expect(calls.map((entry) => entry.key)).toEqual([
      "GET /api/companies",
      "GET /api/companies/company-1/projects",
    ]);
  });

  it("expands an existing company when project count is below the required minimum", async () => {
    const { api, calls } = createApi({
      "GET /api/companies": [
        [{ id: "company-1", name: "cloud-swiftsight", slug: "cloud-swiftsight" }],
      ],
      "GET /api/companies/company-1/projects": [
        [{ id: "project-1", name: "swiftsight-cloud", urlKey: "swiftsight-cloud" }],
        [
          { id: "project-1", name: "swiftsight-cloud", urlKey: "swiftsight-cloud" },
          { id: "project-2", name: "swiftsight-agent", urlKey: "swiftsight-agent" },
        ],
      ],
      "POST /api/companies/company-1/team-blueprints/delivery_plus_qa/preview": {
        previewHash: "preview-1",
        parameters: { projectCount: 2 },
      },
      "POST /api/companies/company-1/team-blueprints/delivery_plus_qa/apply": {
        projectResults: [
          { projectId: "project-1", projectName: "swiftsight-cloud" },
          { projectId: "project-2", projectName: "swiftsight-agent" },
        ],
      },
    });

    const context = await ensureCompanyContext({
      api,
      name: "cloud-swiftsight",
      blueprintKey: "delivery_plus_qa",
      requiredProjectCount: 2,
    });

    expect(context).toEqual({
      company: { id: "company-1", name: "cloud-swiftsight", slug: "cloud-swiftsight" },
      bootstrapped: false,
      expanded: true,
      bootstrapProjectId: "project-1",
      bootstrapProjectName: "swiftsight-cloud",
    });
    expect(calls.map((entry) => entry.key)).toEqual([
      "GET /api/companies",
      "GET /api/companies/company-1/projects",
      "POST /api/companies/company-1/team-blueprints/delivery_plus_qa/preview",
      "POST /api/companies/company-1/team-blueprints/delivery_plus_qa/apply",
      "GET /api/companies/company-1/projects",
    ]);
  });

  it("bootstraps a missing company and returns the first applied project as the default context", async () => {
    const { api, calls } = createApi({
      "GET /api/companies": [[]],
      "POST /api/companies": {
        id: "company-1",
        name: "cloud-swiftsight",
        slug: "cloud-swiftsight",
      },
      "POST /api/companies/company-1/team-blueprints/delivery_plus_qa/preview": {
        previewHash: "preview-1",
        parameters: { projectCount: 1 },
      },
      "POST /api/companies/company-1/team-blueprints/delivery_plus_qa/apply": {
        projectResults: [{ projectId: "project-1", projectName: "swiftsight-cloud" }],
      },
    });

    const context = await ensureCompanyContext({
      api,
      name: "cloud-swiftsight",
      blueprintKey: "delivery_plus_qa",
      requiredProjectCount: 1,
    });

    expect(context).toEqual({
      company: {
        id: "company-1",
        name: "cloud-swiftsight",
        slug: "cloud-swiftsight",
      },
      bootstrapped: true,
      expanded: false,
      bootstrapProjectId: "project-1",
      bootstrapProjectName: "swiftsight-cloud",
    });
    expect(calls.map((entry) => entry.key)).toEqual([
      "GET /api/companies",
      "POST /api/companies",
      "POST /api/companies/company-1/team-blueprints/delivery_plus_qa/preview",
      "POST /api/companies/company-1/team-blueprints/delivery_plus_qa/apply",
    ]);
  });

  it("falls back to the only project when a hint misses", async () => {
    const { api } = createApi({
      "GET /api/companies/company-1/projects": [
        [{ id: "project-1", name: "swiftsight-cloud", urlKey: "swiftsight-cloud" }],
      ],
    });

    const project = await resolveProject({
      api,
      companyId: "company-1",
      hint: "missing-project",
    });

    expect(project).toEqual({
      id: "project-1",
      name: "swiftsight-cloud",
      urlKey: "swiftsight-cloud",
    });
  });

  it("returns the requested number of projects with the hinted primary project first", async () => {
    const { api } = createApi({
      "GET /api/companies/company-1/projects": [
        [
          { id: "project-2", name: "swiftsight-agent", urlKey: "swiftsight-agent" },
          { id: "project-1", name: "swiftsight-cloud", urlKey: "swiftsight-cloud" },
          { id: "project-3", name: "swiftsight-studio", urlKey: "swiftsight-studio" },
        ],
        [
          { id: "project-2", name: "swiftsight-agent", urlKey: "swiftsight-agent" },
          { id: "project-1", name: "swiftsight-cloud", urlKey: "swiftsight-cloud" },
          { id: "project-3", name: "swiftsight-studio", urlKey: "swiftsight-studio" },
        ],
      ],
    });

    const projects = await resolveProjects({
      api,
      companyId: "company-1",
      hint: "swiftsight-cloud",
      requiredCount: 2,
      variantLabel: "baseline",
    });

    expect(projects.map((project) => project.id)).toEqual(["project-1", "project-2"]);
  });

  it("fails when multi-project bootstrap cannot satisfy the required count", async () => {
    const { api } = createApi({
      "GET /api/companies/company-1/projects": [
        [{ id: "project-1", name: "swiftsight-cloud", urlKey: "swiftsight-cloud" }],
        [{ id: "project-1", name: "swiftsight-cloud", urlKey: "swiftsight-cloud" }],
      ],
    });

    await expect(
      resolveProjects({
        api,
        companyId: "company-1",
        hint: "swiftsight-cloud",
        requiredCount: 2,
        variantLabel: "baseline",
      }),
    ).rejects.toThrow("Expected at least 2 projects for baseline; found 1.");
  });
});
