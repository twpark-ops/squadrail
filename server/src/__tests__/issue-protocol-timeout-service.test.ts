import {
  issueProtocolMessages,
  issueProtocolState,
} from "@squadrail/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAppendMessage,
  mockDispatchMessage,
  mockLogActivity,
  mockLoggerWarn,
} = vi.hoisted(() => ({
  mockAppendMessage: vi.fn(),
  mockDispatchMessage: vi.fn(),
  mockLogActivity: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock("../services/issue-protocol.js", () => ({
  issueProtocolService: () => ({
    appendMessage: mockAppendMessage,
  }),
}));

vi.mock("../services/issue-protocol-execution.js", () => ({
  issueProtocolExecutionService: () => ({
    dispatchMessage: mockDispatchMessage,
  }),
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: mockLogActivity,
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    warn: mockLoggerWarn,
  },
}));

import { issueProtocolTimeoutService } from "../services/issue-protocol-timeouts.js";

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
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(shiftTableRows(selectRows, selectedTable)).then(resolve),
  };
  return chain;
}

function createTimeoutDbMock(input?: {
  selectRows?: Map<unknown, unknown[][]>;
}) {
  const selectRows = input?.selectRows ?? new Map();
  return {
    db: {
      select: () => createResolvedSelectChain(selectRows),
    },
  };
}

describe("issue protocol timeout service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendMessage.mockResolvedValue({
      message: {
        id: "message-system-1",
      },
    });
    mockDispatchMessage.mockResolvedValue(null);
    mockLogActivity.mockResolvedValue(null);
  });

  it("sends a reminder when an assigned issue stays idle past the reminder threshold", async () => {
    const now = new Date("2026-03-13T12:00:00.000Z");
    const { db } = createTimeoutDbMock({
      selectRows: new Map([
        [issueProtocolState, [[{
          issueId: "issue-1",
          companyId: "company-1",
          workflowState: "assigned",
          lastTransitionAt: new Date("2026-03-13T11:00:00.000Z"),
          primaryEngineerAgentId: "engineer-1",
          reviewerAgentId: null,
          qaAgentId: null,
          techLeadAgentId: "lead-1",
        }]]],
        [issueProtocolMessages, [[]]],
      ]),
    });
    const service = issueProtocolTimeoutService(db as never);

    const result = await service.tick(now);

    expect(result).toEqual({
      scanned: 1,
      remindersSent: 1,
      escalationsSent: 0,
    });
    expect(mockAppendMessage).toHaveBeenCalledWith(expect.objectContaining({
      issueId: "issue-1",
      message: expect.objectContaining({
        messageType: "SYSTEM_REMINDER",
        recipients: [
          {
            recipientType: "agent",
            recipientId: "engineer-1",
            role: "engineer",
          },
        ],
      }),
    }));
    expect(mockDispatchMessage).toHaveBeenCalledWith(expect.objectContaining({
      protocolMessageId: "message-system-1",
    }));
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "issue.protocol_timeout.reminder",
      entityId: "issue-1",
    }));
  });

  it("sends a timeout escalation and tolerates dispatch failures", async () => {
    const now = new Date("2026-03-13T12:00:00.000Z");
    mockDispatchMessage.mockRejectedValueOnce(new Error("dispatch offline"));
    const { db } = createTimeoutDbMock({
      selectRows: new Map([
        [issueProtocolState, [[{
          issueId: "issue-2",
          companyId: "company-1",
          workflowState: "blocked",
          lastTransitionAt: new Date("2026-03-13T00:00:00.000Z"),
          primaryEngineerAgentId: "engineer-1",
          reviewerAgentId: null,
          qaAgentId: null,
          techLeadAgentId: "lead-1",
        }]]],
        [issueProtocolMessages, [[{
          id: "message-blocker-1",
          issueId: "issue-2",
          companyId: "company-1",
          seq: 3,
          messageType: "ESCALATE_BLOCKER",
          payload: {
            blockerCode: "workspace_missing",
          },
          createdAt: new Date("2026-03-13T02:00:00.000Z"),
        }]]],
      ]),
    });
    const service = issueProtocolTimeoutService(db as never);

    const result = await service.tick(now);

    expect(result).toEqual({
      scanned: 1,
      remindersSent: 0,
      escalationsSent: 1,
    });
    expect(mockAppendMessage).toHaveBeenCalledWith(expect.objectContaining({
      issueId: "issue-2",
      message: expect.objectContaining({
        messageType: "TIMEOUT_ESCALATION",
        recipients: [
          {
            recipientType: "role_group",
            recipientId: "human_board",
            role: "human_board",
          },
        ],
      }),
    }));
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "issue-2",
        protocolMessageType: "TIMEOUT_ESCALATION",
      }),
      "failed to dispatch timeout protocol execution wakeups",
    );
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "issue.protocol_timeout.escalated",
      entityId: "issue-2",
    }));
  });
});
