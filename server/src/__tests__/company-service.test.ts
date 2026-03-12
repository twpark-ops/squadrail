import {
  activityLog,
  agentApiKeys,
  agentConfigRevisions,
  agentRuntimeState,
  agents,
  agentTaskSessions,
  agentWakeupRequests,
  approvalComments,
  approvals,
  assets,
  companies,
  companyMemberships,
  companySecrets,
  costEvents,
  goals,
  heartbeatRunEvents,
  heartbeatRunLeases,
  heartbeatRuns,
  invites,
  issueApprovals,
  issueAttachments,
  issueComments,
  issueLabels,
  issueProtocolArtifacts,
  issueProtocolMessages,
  issueProtocolRecipients,
  issueProtocolState,
  issueProtocolThreads,
  issueProtocolViolations,
  issueReviewCycles,
  issues,
  issueTaskBriefs,
  joinRequests,
  knowledgeChunkLinks,
  knowledgeChunks,
  knowledgeDocuments,
  labels,
  principalPermissionGrants,
  projectGoals,
  projects,
  projectWorkspaces,
  retrievalPolicies,
  retrievalRunHits,
  retrievalRuns,
  rolePackSets,
  setupProgress,
} from "@squadrail/db";
import { describe, expect, it } from "vitest";
import { companyService } from "../services/companies.js";

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    groupBy: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createCompanyDbMock(input: {
  selectResults?: unknown[][];
  insertResults?: Array<unknown[] | Error>;
  updateResults?: unknown[][];
  deleteResults?: unknown[][];
}) {
  const selectQueue = [...(input.selectResults ?? [])];
  const insertQueue = [...(input.insertResults ?? [])];
  const updateQueue = [...(input.updateResults ?? [])];
  const deleteQueue = [...(input.deleteResults ?? [])];
  const insertValues: Array<{ table: unknown; value: unknown }> = [];
  const updateSets: Array<{ table: unknown; value: unknown }> = [];
  const deletedTables: unknown[] = [];

  const db = {
    select: () => createResolvedChain(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues.push({ table, value });
        const next = insertQueue.shift();
        if (next instanceof Error) throw next;
        return {
          returning: async () => next ?? [],
        };
      },
    }),
    update: (table: unknown) => ({
      set: (value: unknown) => {
        updateSets.push({ table, value });
        return {
          where: () => ({
            returning: async () => updateQueue.shift() ?? [],
          }),
        };
      },
    }),
    delete: (table: unknown) => ({
      where: () => {
        deletedTables.push(table);
        return {
          returning: async () => deleteQueue.shift() ?? [],
        };
      },
    }),
    transaction: async <T>(callback: (tx: typeof db) => Promise<T>) => callback(db),
  };

  return {
    db,
    insertValues,
    updateSets,
    deletedTables,
  };
}

describe("company service", () => {
  it("retries issue prefix allocation when the first prefix collides", async () => {
    const duplicatePrefixError = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "companies_issue_prefix_idx",
    });
    const { db, insertValues } = createCompanyDbMock({
      insertResults: [
        duplicatePrefixError,
        [{
          id: "company-1",
          name: "Acme Labs",
          issuePrefix: "ACMA",
        }],
      ],
    });
    const service = companyService(db as never);

    const created = await service.create({
      name: "Acme Labs",
      status: "active",
      budgetMonthlyCents: 0,
    });

    expect(created).toMatchObject({
      id: "company-1",
      issuePrefix: "ACMA",
    });
    expect(insertValues).toEqual([
      {
        table: companies,
        value: expect.objectContaining({
          name: "Acme Labs",
          issuePrefix: "ACM",
        }),
      },
      {
        table: companies,
        value: expect.objectContaining({
          name: "Acme Labs",
          issuePrefix: "ACMA",
        }),
      },
    ]);
  });

  it("aggregates company stats from agent and issue counts", async () => {
    const { db } = createCompanyDbMock({
      selectResults: [
        [
          { companyId: "company-1", count: 3 },
          { companyId: "company-2", count: 1 },
        ],
        [
          { companyId: "company-1", count: 7 },
          { companyId: "company-3", count: 2 },
        ],
      ],
    });
    const service = companyService(db as never);

    const stats = await service.stats();

    expect(stats).toEqual({
      "company-1": { agentCount: 3, issueCount: 7 },
      "company-2": { agentCount: 1, issueCount: 0 },
      "company-3": { agentCount: 0, issueCount: 2 },
    });
  });

  it("removes company-owned records in dependency order before deleting the company", async () => {
    const { db, deletedTables } = createCompanyDbMock({
      deleteResults: [[{
        id: "company-1",
        name: "Acme Labs",
      }]],
    });
    const service = companyService(db as never);

    const removed = await service.remove("company-1");

    expect(removed).toMatchObject({
      id: "company-1",
      name: "Acme Labs",
    });
    expect(deletedTables).toEqual([
      heartbeatRunLeases,
      heartbeatRunEvents,
      agentTaskSessions,
      heartbeatRuns,
      agentWakeupRequests,
      agentApiKeys,
      agentRuntimeState,
      agentConfigRevisions,
      issueAttachments,
      assets,
      issueProtocolArtifacts,
      issueProtocolRecipients,
      issueProtocolMessages,
      issueProtocolViolations,
      issueReviewCycles,
      issueProtocolState,
      issueProtocolThreads,
      issueTaskBriefs,
      issueLabels,
      labels,
      issueApprovals,
      issueComments,
      retrievalRunHits,
      retrievalRuns,
      retrievalPolicies,
      knowledgeChunkLinks,
      knowledgeChunks,
      knowledgeDocuments,
      costEvents,
      approvalComments,
      approvals,
      companySecrets,
      joinRequests,
      invites,
      principalPermissionGrants,
      companyMemberships,
      rolePackSets,
      setupProgress,
      issues,
      goals,
      projectGoals,
      projectWorkspaces,
      projects,
      agents,
      activityLog,
      companies,
    ]);
  });
});
