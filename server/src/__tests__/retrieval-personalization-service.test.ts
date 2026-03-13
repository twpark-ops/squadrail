import {
  issueProtocolMessages,
  issueTaskBriefs,
  issues,
  retrievalFeedbackEvents,
  retrievalRoleProfiles,
  retrievalRuns,
} from "@squadrail/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockListRetrievalRunHits,
  mockUpdateRetrievalRunDebug,
} = vi.hoisted(() => ({
  mockListRetrievalRunHits: vi.fn(),
  mockUpdateRetrievalRunDebug: vi.fn(),
}));

vi.mock("../services/knowledge.js", () => ({
  knowledgeService: () => ({
    listRetrievalRunHits: mockListRetrievalRunHits,
    updateRetrievalRunDebug: mockUpdateRetrievalRunDebug,
  }),
}));

import { retrievalPersonalizationService } from "../services/retrieval-personalization.js";

function shiftTableRows(queueMap: Map<unknown, unknown[][]>, table: unknown) {
  const queue = queueMap.get(table);
  return queue?.shift() ?? [];
}

function createResolvedSelectChain(selectRows: Map<unknown, unknown[][]>) {
  let selectedTable: unknown = null;
  const chain = {
    from: (table: unknown) => {
      selectedTable = table;
      return chain;
    },
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    innerJoin: () => chain,
    selectDistinct: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(shiftTableRows(selectRows, selectedTable)).then(resolve),
  };
  return chain;
}

function createMutationResult(queueMap: Map<unknown, unknown[][]>, table: unknown) {
  return {
    returning: async () => shiftTableRows(queueMap, table),
    then: <T>(resolve: (value: undefined) => T | PromiseLike<T>) => Promise.resolve(undefined).then(resolve),
  };
}

function createRetrievalDbMock(input?: {
  selectRows?: Map<unknown, unknown[][]>;
  insertRows?: Map<unknown, unknown[][]>;
  updateRows?: Map<unknown, unknown[][]>;
}) {
  const selectRows = input?.selectRows ?? new Map();
  const insertRows = input?.insertRows ?? new Map();
  const updateRows = input?.updateRows ?? new Map();
  const insertValues: Array<{ table: unknown; value: unknown }> = [];
  const updateSets: Array<{ table: unknown; value: unknown }> = [];

  const db = {
    select: () => createResolvedSelectChain(selectRows),
    selectDistinct: () => createResolvedSelectChain(selectRows),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues.push({ table, value });
        return createMutationResult(insertRows, table);
      },
    }),
    update: (table: unknown) => ({
      set: (value: unknown) => {
        updateSets.push({ table, value });
        return {
          where: () => createMutationResult(updateRows, table),
        };
      },
    }),
  };

  return { db, insertValues, updateSets };
}

describe("retrieval personalization service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListRetrievalRunHits.mockResolvedValue([]);
    mockUpdateRetrievalRunDebug.mockResolvedValue(null);
  });

  it("loads and merges global and project profiles for a role", async () => {
    const { db } = createRetrievalDbMock({
      selectRows: new Map([
        [retrievalRoleProfiles, [[
          {
            projectId: null,
            profileJson: {
              version: 1,
              sourceTypeBoosts: { code: 0.2 },
              pathBoosts: { "src/runtime.ts": 0.18 },
              symbolBoosts: {},
              stats: {
                feedbackCount: 2,
                positiveFeedbackCount: 2,
                negativeFeedbackCount: 0,
                mergeCompletedCount: 1,
                mergeRejectedCount: 0,
                operatorPinCount: 0,
                operatorHideCount: 0,
                lastFeedbackAt: "2026-03-13T00:00:00.000Z",
              },
              generatedAt: "2026-03-13T00:00:00.000Z",
            },
          },
          {
            projectId: "project-1",
            profileJson: {
              version: 1,
              sourceTypeBoosts: { code: 0.25 },
              pathBoosts: { "src/runtime.ts": 0.31 },
              symbolBoosts: { runtimeWorker: 0.12 },
              stats: {
                feedbackCount: 3,
                positiveFeedbackCount: 2,
                negativeFeedbackCount: 1,
                mergeCompletedCount: 1,
                mergeRejectedCount: 0,
                operatorPinCount: 0,
                operatorHideCount: 0,
                lastFeedbackAt: "2026-03-13T02:00:00.000Z",
              },
              generatedAt: "2026-03-13T02:00:00.000Z",
            },
          },
        ]]],
      ]),
    });
    const service = retrievalPersonalizationService(db as never);

    const profile = await service.loadProfile({
      companyId: "company-1",
      projectId: "project-1",
      role: "reviewer",
      eventType: "issue_review",
    });

    expect(profile.applied).toBe(true);
    expect(profile.scopes).toEqual(["global", "project"]);
    expect(profile.pathBoosts["src/runtime.ts"]).toBeGreaterThan(0.45);
    expect(profile.symbolBoosts.runtimeWorker).toBeGreaterThan(0);
  });

  it("records manual path feedback, rebuilds profile scopes, and updates run debug metadata", async () => {
    mockListRetrievalRunHits.mockResolvedValue([
      {
        chunkId: "chunk-1",
        selected: true,
        finalRank: 1,
        sourceType: "code",
        documentPath: "src/runtime.ts",
        symbolName: "runtimeWorker",
        rationale: "direct code match",
        fusedScore: 1.12,
      },
    ]);
    const { db, insertValues } = createRetrievalDbMock({
      selectRows: new Map([
        [retrievalRuns, [[{
          id: "run-1",
          issueId: "issue-1",
          actorRole: "reviewer",
          eventType: "issue_review",
          queryDebug: { issueProjectId: "project-1" },
        }]]],
        [retrievalFeedbackEvents, [
          [{
            targetType: "path",
            targetId: "src/runtime.ts",
            weight: 1.05,
            feedbackType: "operator_pin",
            createdAt: new Date("2026-03-13T03:00:00.000Z"),
          }],
          [{
            targetType: "path",
            targetId: "src/runtime.ts",
            weight: 1.05,
            feedbackType: "operator_pin",
            createdAt: new Date("2026-03-13T03:00:00.000Z"),
          }],
        ]],
        [retrievalRoleProfiles, [[], []]],
      ]),
      insertRows: new Map([
        [retrievalRoleProfiles, [[{ id: "profile-global" }], [{ id: "profile-project" }]]],
      ]),
    });
    const service = retrievalPersonalizationService(db as never);

    const result = await service.recordManualFeedback({
      companyId: "company-1",
      issueId: "issue-1",
      issueProjectId: "project-1",
      retrievalRunId: "run-1",
      feedbackType: "operator_pin",
      targetType: "path",
      targetIds: ["./src/runtime.ts"],
      actorRole: "human_board",
      noteBody: "Keep this file highly ranked.",
    });

    expect(result).toMatchObject({
      ok: true,
      feedbackEventCount: 2,
      profiledRunCount: 1,
      retrievalRunIds: ["run-1"],
    });
    expect(insertValues.find((entry) => entry.table === retrievalFeedbackEvents)?.value).toEqual([
      expect.objectContaining({
        targetType: "path",
        targetId: "src/runtime.ts",
        feedbackType: "operator_pin",
      }),
      expect.objectContaining({
        targetType: "source_type",
        targetId: "code",
        metadata: expect.objectContaining({
          promotedByPathFeedback: true,
        }),
      }),
    ]);
    expect(mockUpdateRetrievalRunDebug).toHaveBeenCalledWith("run-1", expect.objectContaining({
      feedback: expect.objectContaining({
        lastFeedbackType: "operator_pin",
        lastFeedbackActorRole: "human_board",
        manualFeedback: true,
      }),
    }));
  });

  it("short-circuits merge outcome feedback when the close message was already processed", async () => {
    const { db } = createRetrievalDbMock({
      selectRows: new Map([
        [retrievalFeedbackEvents, [[{ count: 1 }]]],
      ]),
    });
    const service = retrievalPersonalizationService(db as never);

    await expect(service.recordMergeCandidateOutcomeFeedback({
      companyId: "company-1",
      issueId: "issue-1",
      issueProjectId: "project-1",
      closeMessageId: "message-close-1",
      outcome: "merge_completed",
      changedFiles: ["src/runtime.ts"],
      mergeStatus: "merged",
    })).resolves.toEqual({
      ok: false,
      feedbackEventCount: 0,
      profiledRunCount: 0,
      retrievalRunIds: [],
    });
  });

  it("summarizes positive, negative, pin, and hide feedback counts for an issue", async () => {
    const { db } = createRetrievalDbMock({
      selectRows: new Map([
        [retrievalFeedbackEvents, [[
          {
            feedbackType: "operator_pin",
            targetType: "path",
            targetId: "src/runtime.ts",
            weight: 1,
            createdAt: new Date("2026-03-13T05:00:00.000Z"),
          },
          {
            feedbackType: "operator_hide",
            targetType: "path",
            targetId: "src/noisy.ts",
            weight: -0.9,
            createdAt: new Date("2026-03-13T04:00:00.000Z"),
          },
          {
            feedbackType: "approved",
            targetType: "chunk",
            targetId: "chunk-1",
            weight: 0.7,
            createdAt: new Date("2026-03-13T03:00:00.000Z"),
          },
        ]]],
      ]),
    });
    const service = retrievalPersonalizationService(db as never);

    const summary = await service.summarizeIssueFeedback({
      companyId: "company-1",
      issueId: "issue-1",
    });

    expect(summary).toMatchObject({
      positiveCount: 2,
      negativeCount: 1,
      pinnedPathCount: 1,
      hiddenPathCount: 1,
      feedbackTypeCounts: {
        operator_pin: 1,
        operator_hide: 1,
        approved: 1,
      },
    });
  });

  it("backfills protocol feedback from existing review messages and brief-linked runs", async () => {
    mockListRetrievalRunHits.mockResolvedValue([
      {
        chunkId: "chunk-1",
        selected: true,
        finalRank: 1,
        sourceType: "code",
        documentPath: "src/runtime.ts",
        symbolName: "runtimeWorker",
        rationale: "reviewed diff",
        fusedScore: 0.93,
      },
    ]);
    const { db, insertValues } = createRetrievalDbMock({
      selectRows: new Map([
        [retrievalFeedbackEvents, [
          [{ feedbackMessageId: "message-old" }],
          [{
            targetType: "path",
            targetId: "src/runtime.ts",
            weight: -1,
            feedbackType: "request_changes",
            createdAt: new Date("2026-03-13T07:00:00.000Z"),
          }],
          [{
            targetType: "path",
            targetId: "src/runtime.ts",
            weight: -1,
            feedbackType: "request_changes",
            createdAt: new Date("2026-03-13T07:00:00.000Z"),
          }],
        ]],
        [issueProtocolMessages, [[
          {
            issueId: "issue-1",
            issueProjectId: "project-1",
            messageId: "message-old",
            seq: 1,
            messageType: "APPROVE_IMPLEMENTATION",
            senderActorType: "agent",
            senderActorId: "reviewer-1",
            senderRole: "reviewer",
            workflowStateBefore: "under_review",
            workflowStateAfter: "approved",
            payload: {},
            retrievalRunId: "run-old",
          },
          {
            issueId: "issue-1",
            issueProjectId: "project-1",
            messageId: "message-new",
            seq: 2,
            messageType: "REQUEST_CHANGES",
            senderActorType: "agent",
            senderActorId: "reviewer-1",
            senderRole: "reviewer",
            workflowStateBefore: "under_review",
            workflowStateAfter: "changes_requested",
            payload: {},
            retrievalRunId: null,
          },
        ]]],
        [issueTaskBriefs, [[{
          retrievalRunId: "run-1",
        }]]],
        [retrievalRuns, [[{
          id: "run-1",
          issueId: "issue-1",
          actorRole: "reviewer",
          eventType: "issue_review",
          queryDebug: { issueProjectId: "project-1" },
        }]]],
        [retrievalRoleProfiles, [[], []]],
      ]),
      insertRows: new Map([
        [retrievalRoleProfiles, [[{ id: "profile-global" }], [{ id: "profile-project" }]]],
      ]),
    });
    const service = retrievalPersonalizationService(db as never);

    const result = await service.backfillProtocolFeedback({
      companyId: "company-1",
      projectIds: ["project-1"],
      limit: 10,
    });

    expect(result).toMatchObject({
      scanned: 2,
      replayed: 1,
      profiledRunCount: 1,
    });
    expect(insertValues.find((entry) => entry.table === retrievalFeedbackEvents)?.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          feedbackMessageId: "message-new",
          feedbackType: "request_changes",
          targetType: "chunk",
        }),
      ]),
    );
  });
});
