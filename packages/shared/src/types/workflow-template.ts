import type {
  WorkflowTemplateActionType,
  WorkflowTemplateScope,
} from "../constants.js";

export interface WorkflowTemplate {
  id: string;
  actionType: WorkflowTemplateActionType;
  label: string;
  description: string | null;
  summary: string | null;
  fields: Record<string, string>;
  scope: WorkflowTemplateScope;
}

export interface WorkflowTemplatesView {
  companyId: string;
  templates: WorkflowTemplate[];
  companyTemplates: WorkflowTemplate[];
  updatedAt: Date | null;
}
