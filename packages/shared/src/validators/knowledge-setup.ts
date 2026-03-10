import { z } from "zod";

const knowledgeSyncJobStatuses = ["queued", "running", "completed", "failed"] as const;

export const repairOrgSyncSchema = z.object({
  createMissing: z.boolean().optional().default(true),
  adoptLegacySingleEngineers: z.boolean().optional().default(true),
  repairMismatches: z.boolean().optional().default(true),
  pauseLegacyExtras: z.boolean().optional().default(true),
}).strict();

export type RepairOrgSync = z.infer<typeof repairOrgSyncSchema>;

export const createKnowledgeSyncJobSchema = z.object({
  projectIds: z.array(z.string().uuid()).min(1).optional(),
  forceFull: z.boolean().optional().default(false),
  maxFiles: z.number().int().min(1).max(500).optional(),
  rebuildGraph: z.boolean().optional().default(true),
  rebuildVersions: z.boolean().optional().default(true),
  backfillPersonalization: z.boolean().optional().default(true),
}).strict();

export type CreateKnowledgeSyncJob = z.infer<typeof createKnowledgeSyncJobSchema>;

export const knowledgeSyncJobStatusSchema = z.enum(knowledgeSyncJobStatuses);
