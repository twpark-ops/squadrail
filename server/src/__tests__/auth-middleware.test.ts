import { describe, expect, it } from "vitest";
import { actorMiddleware, resolveExistingRunId } from "../middleware/auth.js";

function buildReq(headers: Record<string, string>) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    method: "GET",
    originalUrl: "/actor",
    header(name: string) {
      return normalized[name.toLowerCase()];
    },
    actor: { type: "none", source: "none" },
  } as any;
}

describe("actorMiddleware", () => {
  it("reads X-Squadrail-Run-Id into actor context", async () => {
    const req = buildReq({
      "X-Squadrail-Run-Id": "run-new",
    });
    const middleware = actorMiddleware({} as any, { deploymentMode: "local_trusted" });

    await middleware(req, {} as any, () => undefined);

    expect(req.actor.runId).toBe("run-new");
  });

  it("keeps an agent run id only when the heartbeat run exists for that agent", async () => {
    const knownDb = {
      select() {
        return {
          from() {
            return {
              where() {
                return Promise.resolve([{ id: "known-run" }]);
              },
            };
          },
        };
      },
    } as any;

    const missingDb = {
      select() {
        return {
          from() {
            return {
              where() {
                return Promise.resolve([]);
              },
            };
          },
        };
      },
    } as any;

    await expect(
      resolveExistingRunId(
        knownDb,
        "known-run",
        "19bb753c-2160-4046-aa1a-8aacd9e39e90",
        "b513fea8-1df8-4566-b23f-0d121f04c32e",
      ),
    ).resolves.toBe("known-run");

    await expect(
      resolveExistingRunId(
        missingDb,
        "missing-run",
        "19bb753c-2160-4046-aa1a-8aacd9e39e90",
        "b513fea8-1df8-4566-b23f-0d121f04c32e",
      ),
    ).resolves.toBeUndefined();
  });
});
