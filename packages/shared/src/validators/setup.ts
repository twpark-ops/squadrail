import { z } from "zod";
import {
  AGENT_ADAPTER_TYPES,
  SETUP_PROGRESS_STATES,
} from "../constants.js";

export const updateSetupProgressSchema = z.object({
  status: z.enum(SETUP_PROGRESS_STATES).optional(),
  selectedEngine: z.enum(AGENT_ADAPTER_TYPES).nullable().optional(),
  selectedWorkspaceId: z.string().uuid().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

export type UpdateSetupProgress = z.infer<typeof updateSetupProgressSchema>;
