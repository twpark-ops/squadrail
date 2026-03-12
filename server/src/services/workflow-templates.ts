import { eq } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import { setupProgress } from "@squadrail/db";
import type {
  UpdateWorkflowTemplates,
  WorkflowTemplate,
  WorkflowTemplatesView,
} from "@squadrail/shared";
import { setupProgressService } from "./setup-progress.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, current]) =>
      typeof current === "string" ? [[key, current]] as const : [],
    ),
  );
}

function renderDefaultTemplates(): WorkflowTemplate[] {
  return [
    {
      id: "default-assign-task",
      actionType: "ASSIGN_TASK",
      label: "Default Assignment",
      description: "Baseline execution staffing with reviewer ownership and evidence-backed scope.",
      summary: "Board assigned {issueIdentifier} for execution",
      fields: {
        goal: "Deliver {issueIdentifier} with explicit scope, reviewer ownership, and rollout-safe evidence.",
        acceptanceCriteria: "Implementation scope is explicit\nEvidence is attached\nReviewer ownership is assigned",
        definitionOfDone: "Changed files listed\nTests reported\nReview requested with residual risks",
        requiredKnowledgeTags: "code\nadr\nreview",
        priority: "high",
        assignmentRecipientRole: "engineer",
      },
      scope: "default",
    },
    {
      id: "default-reassign-task",
      actionType: "REASSIGN_TASK",
      label: "Default Reassignment",
      description: "Carry forward current brief and reviewer expectations while changing the owner.",
      summary: "Board reassigned {issueIdentifier}",
      fields: {
        reason: "Reassign {issueIdentifier} to unblock delivery while preserving current brief and reviewer expectations.",
        assignmentRecipientRole: "engineer",
      },
      scope: "default",
    },
    {
      id: "default-request-changes",
      actionType: "REQUEST_CHANGES",
      label: "Default Change Request",
      description: "Human review template that asks for stronger evidence before approval.",
      summary: "Board requested changes for {issueIdentifier}",
      fields: {
        reviewSummary: "Human review for {issueIdentifier} requires explicit follow-up before approval.",
        requiredEvidence: "Updated verification evidence\nRollback readiness note",
        changeRequestLines:
          "Strengthen verification evidence|Current handoff does not show enough validation coverage.|docs/release/checklist.md,server/src/__tests__/release.test.ts|Attach the missing verification evidence and summarize the expected rollback trigger.",
      },
      scope: "default",
    },
    {
      id: "default-approve-implementation",
      actionType: "APPROVE_IMPLEMENTATION",
      label: "Default Approval",
      description: "Approval summary with explicit checklist, evidence, and residual risk.",
      summary: "Board approved implementation for {issueIdentifier}",
      fields: {
        approvalSummary: "Approval for {issueIdentifier} is based on attached evidence, review outcomes, and rollout readiness.",
        approvalChecklist: "Acceptance criteria covered\nVerification evidence reviewed\nResidual risks recorded",
        verifiedEvidence: "Reviewed diff and retrieval brief\nValidated test evidence",
        approvalResidualRisks: "No known residual risk.",
        followUpActions: "Monitor rollout metrics\nTrack follow-up issue if residual risk remains",
        approvalMode: "human_override",
      },
      scope: "default",
    },
    {
      id: "default-close-task",
      actionType: "CLOSE_TASK",
      label: "Default Close",
      description: "Closure handoff with verification, rollback, and follow-up context.",
      summary: "Board closed {issueIdentifier}",
      fields: {
        closureSummary: "Close {issueIdentifier} with explicit delivery and verification context.",
        verificationSummary: "Reviewed merged artifacts, verification evidence, and follow-up state.",
        rollbackPlan: "Revert the merge commit or reopen a follow-up issue if production regressions appear.",
        finalArtifacts: "Implementation merged\nVerification evidence recorded\nOperational follow-up linked",
        remainingRisks: "No unresolved delivery blocker remains",
        closeReason: "completed",
        finalTestStatus: "passed",
        mergeStatus: "merged",
      },
      scope: "default",
    },
    {
      id: "default-cancel-task",
      actionType: "CANCEL_TASK",
      label: "Default Cancellation",
      description: "Operator-safe stop template with replacement path.",
      summary: "Board cancelled {issueIdentifier}",
      fields: {
        reason: "Stop {issueIdentifier} because the scope should move to a replacement task or no longer matches delivery goals.",
        cancelType: "manual_stop",
      },
      scope: "default",
    },
    {
      id: "default-note",
      actionType: "NOTE",
      label: "Default Note",
      description: "Context-preserving board note for the current issue.",
      summary: "Board note for {issueIdentifier}",
      fields: {
        noteType: "context",
        body: "Board context for {issueIdentifier}: preserve the current workflow intent and keep the next handoff evidence-backed.",
      },
      scope: "default",
    },
  ];
}

function normalizeCompanyTemplate(input: unknown): WorkflowTemplate | null {
  const record = asRecord(input);
  const id = readString(record.id);
  const actionType = readString(record.actionType);
  const label = readString(record.label);
  if (!id || !label) return null;
  if (
    actionType !== "ASSIGN_TASK"
    && actionType !== "REASSIGN_TASK"
    && actionType !== "REQUEST_CHANGES"
    && actionType !== "APPROVE_IMPLEMENTATION"
    && actionType !== "CLOSE_TASK"
    && actionType !== "CANCEL_TASK"
    && actionType !== "NOTE"
  ) {
    return null;
  }
  return {
    id,
    actionType,
    label,
    description: readString(record.description),
    summary: readString(record.summary),
    fields: readFields(record.fields),
    scope: "company",
  };
}

function serializeCompanyTemplate(template: WorkflowTemplate) {
  return {
    id: template.id,
    actionType: template.actionType,
    label: template.label,
    description: template.description,
    summary: template.summary,
    fields: template.fields,
  };
}

export function workflowTemplateService(db: Db) {
  const setup = setupProgressService(db);

  async function getSetupRow(companyId: string) {
    return db
      .select({
        metadata: setupProgress.metadata,
        updatedAt: setupProgress.updatedAt,
      })
      .from(setupProgress)
      .where(eq(setupProgress.companyId, companyId))
      .then((rows) => rows[0] ?? null);
  }

  async function getView(companyId: string): Promise<WorkflowTemplatesView> {
    const row = await getSetupRow(companyId);
    const metadata = asRecord(row?.metadata);
    const companyTemplates = Array.isArray(metadata.workflowTemplates)
      ? metadata.workflowTemplates
          .map((entry) => normalizeCompanyTemplate(entry))
          .filter((entry): entry is WorkflowTemplate => entry !== null)
      : [];
    return {
      companyId,
      templates: [
        ...renderDefaultTemplates(),
        ...companyTemplates,
      ],
      companyTemplates,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async function updateConfig(companyId: string, input: UpdateWorkflowTemplates): Promise<WorkflowTemplatesView> {
    await setup.update(companyId, {
      metadata: {
        workflowTemplates: input.templates.map((entry) =>
          serializeCompanyTemplate({
            id: entry.id,
            actionType: entry.actionType,
            label: entry.label,
            description: entry.description ?? null,
            summary: entry.summary ?? null,
            fields: entry.fields ?? {},
            scope: "company",
          }),
        ),
      },
    });
    return getView(companyId);
  }

  return {
    getView,
    updateConfig,
  };
}
