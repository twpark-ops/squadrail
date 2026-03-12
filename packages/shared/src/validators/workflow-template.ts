import { z } from "zod";
import { WORKFLOW_TEMPLATE_ACTION_TYPES } from "../constants.js";

const workflowTemplateFieldsSchema = z.record(z.string().max(10_000));

const workflowTemplateDraftSchema = z.object({
  id: z.string().trim().min(1).max(120),
  actionType: z.enum(WORKFLOW_TEMPLATE_ACTION_TYPES),
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1_000).nullable().optional(),
  summary: z.string().trim().max(500).nullable().optional(),
  fields: workflowTemplateFieldsSchema.optional().default({}),
}).strict();

export const updateWorkflowTemplatesSchema = z.object({
  templates: z.array(workflowTemplateDraftSchema).max(50),
}).strict();

export type UpdateWorkflowTemplates = z.infer<typeof updateWorkflowTemplatesSchema>;
