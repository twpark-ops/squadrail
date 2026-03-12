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
}).strict().superRefine((input, ctx) => {
  const seen = new Map<string, number>();

  input.templates.forEach((template, index) => {
    const normalizedId = template.id.trim().toLowerCase();
    if (normalizedId.startsWith("default-")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["templates", index, "id"],
        message: "Company workflow template IDs cannot use the reserved default-* prefix",
      });
    }

    const existingIndex = seen.get(normalizedId);
    if (existingIndex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["templates", index, "id"],
        message: `Workflow template IDs must be unique; duplicates template at index ${existingIndex}`,
      });
      return;
    }
    seen.set(normalizedId, index);
  });
});

export type UpdateWorkflowTemplates = z.infer<typeof updateWorkflowTemplatesSchema>;
