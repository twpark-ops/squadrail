import { z } from "zod";
import {
  PROJECT_STATUSES,
  PROJECT_WORKSPACE_EXECUTION_MODES,
  PROJECT_WORKSPACE_ISOLATION_STRATEGIES,
  PROJECT_WORKSPACE_USAGE_PROFILES,
} from "../constants.js";
import type { ProjectWorkspaceExecutionPolicy } from "../types/project.js";

const defaultUsageProfilesByMode = {
  shared: ["analysis", "review"] as const,
  isolated: ["implementation"] as const,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export const projectWorkspaceUsageProfileSchema = z.enum(PROJECT_WORKSPACE_USAGE_PROFILES);
export const projectWorkspaceExecutionPolicySchema = z.object({
  mode: z.enum(PROJECT_WORKSPACE_EXECUTION_MODES).default("shared"),
  applyFor: z.array(projectWorkspaceUsageProfileSchema).optional(),
  isolationStrategy: z.enum(PROJECT_WORKSPACE_ISOLATION_STRATEGIES).optional().nullable(),
  isolatedRoot: z.string().min(1).optional().nullable(),
  branchTemplate: z.string().min(1).optional().nullable(),
  writable: z.boolean().optional(),
}).transform((value) => {
  const mode = value.mode ?? "shared";
  const applyFor = [...new Set(
    (value.applyFor && value.applyFor.length > 0
      ? value.applyFor
      : defaultUsageProfilesByMode[mode]) as string[],
  )] as ProjectWorkspaceExecutionPolicy["applyFor"];
  return {
    mode,
    applyFor,
    isolationStrategy: mode === "isolated" ? (value.isolationStrategy ?? "worktree") : null,
    isolatedRoot: mode === "isolated" ? (value.isolatedRoot ?? null) : null,
    branchTemplate: mode === "isolated" ? (value.branchTemplate ?? null) : null,
    writable: value.writable ?? (mode === "isolated"),
  } satisfies ProjectWorkspaceExecutionPolicy;
}).superRefine((value, ctx) => {
  if (value.applyFor.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Workspace execution policy requires at least one applyFor usage profile.",
      path: ["applyFor"],
    });
  }
});

export type ProjectWorkspaceExecutionPolicyInput = z.input<typeof projectWorkspaceExecutionPolicySchema>;

export function parseProjectWorkspaceExecutionPolicy(
  value: unknown,
): ProjectWorkspaceExecutionPolicy | null {
  const parsed = projectWorkspaceExecutionPolicySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function readProjectWorkspaceExecutionPolicyFromMetadata(
  metadata: unknown,
): ProjectWorkspaceExecutionPolicy | null {
  const record = asRecord(metadata);
  if (!record) return null;
  return parseProjectWorkspaceExecutionPolicy(record.executionPolicy);
}

export function stripProjectWorkspaceExecutionPolicyFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null;
  const next = { ...metadata };
  delete next.executionPolicy;
  return Object.keys(next).length > 0 ? next : null;
}

export function mergeProjectWorkspaceExecutionPolicyIntoMetadata(input: {
  metadata: Record<string, unknown> | null | undefined;
  executionPolicy?: ProjectWorkspaceExecutionPolicy | null;
}): Record<string, unknown> | null {
  const base = input.metadata ? { ...input.metadata } : {};
  if (input.executionPolicy === undefined) {
    return Object.keys(base).length > 0 ? base : null;
  }
  if (input.executionPolicy === null) {
    delete base.executionPolicy;
    return Object.keys(base).length > 0 ? base : null;
  }
  base.executionPolicy = input.executionPolicy;
  return base;
}

const projectWorkspaceFields = {
  name: z.string().min(1).optional(),
  cwd: z.string().min(1).optional().nullable(),
  repoUrl: z.string().url().optional().nullable(),
  repoRef: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
  executionPolicy: projectWorkspaceExecutionPolicySchema.optional().nullable(),
};

export const createProjectWorkspaceSchema = z.object({
  ...projectWorkspaceFields,
  isPrimary: z.boolean().optional().default(false),
}).superRefine((value, ctx) => {
  const hasCwd = typeof value.cwd === "string" && value.cwd.trim().length > 0;
  const hasRepo = typeof value.repoUrl === "string" && value.repoUrl.trim().length > 0;
  if (!hasCwd && !hasRepo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Workspace requires at least one of cwd or repoUrl.",
      path: ["cwd"],
    });
  }
});

export type CreateProjectWorkspace = z.infer<typeof createProjectWorkspaceSchema>;

export const updateProjectWorkspaceSchema = z.object({
  ...projectWorkspaceFields,
  isPrimary: z.boolean().optional(),
}).partial();

export type UpdateProjectWorkspace = z.infer<typeof updateProjectWorkspaceSchema>;

const projectFields = {
  /** @deprecated Use goalIds instead */
  goalId: z.string().uuid().optional().nullable(),
  goalIds: z.array(z.string().uuid()).optional(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  status: z.enum(PROJECT_STATUSES).optional().default("backlog"),
  leadAgentId: z.string().uuid().optional().nullable(),
  targetDate: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  archivedAt: z.string().datetime().optional().nullable(),
};

export const createProjectSchema = z.object({
  ...projectFields,
  workspace: createProjectWorkspaceSchema.optional(),
});

export type CreateProject = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object(projectFields).partial();

export type UpdateProject = z.infer<typeof updateProjectSchema>;
