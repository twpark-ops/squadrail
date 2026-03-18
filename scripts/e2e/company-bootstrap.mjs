import assert from "node:assert/strict";

function normalizeName(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function matchesCompanyName(company, normalized) {
  const companyName = normalizeName(company?.name);
  const slug = normalizeName(company?.slug);
  return companyName === normalized || slug === normalized;
}

export async function resolveCompanyByName(input) {
  const companies = await input.api("/api/companies");
  const normalized = normalizeName(input.name);
  const match = companies.find((company) => matchesCompanyName(company, normalized));
  assert(match, `Company not found for ${input.name}`);
  return match;
}

export async function createCompany(input) {
  return input.api("/api/companies", {
    method: "POST",
    body: {
      name: input.name,
      description: input.description ?? "E2E bootstrap company",
    },
  });
}

export async function listProjects(input) {
  return input.api(`/api/companies/${input.companyId}/projects`);
}

export async function previewTeamBlueprint(input) {
  return input.api(`/api/companies/${input.companyId}/team-blueprints/${input.blueprintKey}/preview`, {
    method: "POST",
    body: input.body,
  });
}

export async function applyTeamBlueprint(input) {
  return input.api(`/api/companies/${input.companyId}/team-blueprints/${input.blueprintKey}/apply`, {
    method: "POST",
    body: {
      previewHash: input.preview.previewHash,
      ...input.preview.parameters,
    },
  });
}

export async function ensureCompanyContext(input) {
  const requiredProjectCount = input.requiredProjectCount ?? 1;
  const companies = await input.api("/api/companies");
  const normalized = normalizeName(input.name);
  const existing = companies.find((company) => matchesCompanyName(company, normalized));

  if (existing) {
    const existingProjects = await listProjects({
      api: input.api,
      companyId: existing.id,
    });
    if (existingProjects.length < requiredProjectCount) {
      input.note?.(
        `company ${input.name} has ${existingProjects.length} project(s); expanding to ${requiredProjectCount}`,
      );
      const preview = await previewTeamBlueprint({
        api: input.api,
        companyId: existing.id,
        blueprintKey: input.blueprintKey,
        body: {
          projectCount: requiredProjectCount,
        },
      });
      await applyTeamBlueprint({
        api: input.api,
        companyId: existing.id,
        blueprintKey: input.blueprintKey,
        preview,
      });
      const expandedProjects = await listProjects({
        api: input.api,
        companyId: existing.id,
      });
      const primaryProject = expandedProjects[0] ?? null;
      return {
        company: existing,
        bootstrapped: false,
        expanded: true,
        bootstrapProjectId: primaryProject?.id ?? null,
        bootstrapProjectName: primaryProject?.name ?? null,
      };
    }

    return {
      company: existing,
      bootstrapped: false,
      expanded: false,
      bootstrapProjectId: null,
      bootstrapProjectName: null,
    };
  }

  input.note?.(`company ${input.name} not found; bootstrapping ${input.blueprintKey}`);
  const company = await createCompany({
    api: input.api,
    name: input.name,
    description: input.description,
  });
  const preview = await previewTeamBlueprint({
    api: input.api,
    companyId: company.id,
    blueprintKey: input.blueprintKey,
    body: {
      projectCount: requiredProjectCount,
    },
  });
  const applied = await applyTeamBlueprint({
    api: input.api,
    companyId: company.id,
    blueprintKey: input.blueprintKey,
    preview,
  });
  const bootstrapProject = applied.projectResults[0] ?? null;

  return {
    company,
    bootstrapped: true,
    expanded: false,
    bootstrapProjectId: bootstrapProject?.projectId ?? null,
    bootstrapProjectName: bootstrapProject?.projectName ?? null,
  };
}

export async function resolveProject(input) {
  const projects = await listProjects({
    api: input.api,
    companyId: input.companyId,
  });
  if (input.fallbackProjectId) {
    const explicit = projects.find((project) => project.id === input.fallbackProjectId);
    if (explicit) return explicit;
  }

  const normalized = normalizeName(input.hint);
  const match = projects.find((project) => {
    const name = normalizeName(project?.name);
    const urlKey = normalizeName(project?.urlKey);
    return name === normalized || urlKey === normalized || project.id === input.hint;
  });

  if (!match && projects.length === 1) {
    const [fallback] = projects;
    input.note?.(`project hint ${input.hint} not found; falling back to only project ${fallback.name}`);
    return fallback;
  }

  assert(match, `Project not found for ${input.hint}`);
  return match;
}

export async function resolveProjects(input) {
  if ((input.requiredCount ?? 1) <= 1) {
    return [
      await resolveProject({
        api: input.api,
        note: input.note,
        companyId: input.companyId,
        hint: input.hint,
        fallbackProjectId: input.fallbackProjectId ?? null,
      }),
    ];
  }

  const projects = await listProjects({
    api: input.api,
    companyId: input.companyId,
  });
  const primary = await resolveProject({
    api: input.api,
    note: input.note,
    companyId: input.companyId,
    hint: input.hint,
    fallbackProjectId: input.fallbackProjectId ?? null,
  });

  const selected = [primary];
  const remaining = projects
    .filter((project) => project.id !== primary.id)
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const project of remaining) {
    if (selected.length >= input.requiredCount) break;
    selected.push(project);
  }

  assert(
    selected.length >= input.requiredCount,
    `Expected at least ${input.requiredCount} projects for ${input.variantLabel ?? "bootstrap"}; found ${selected.length}.`,
  );
  return selected.slice(0, input.requiredCount);
}
