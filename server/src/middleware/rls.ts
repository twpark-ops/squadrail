import type { Request, RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { runWithDbContext, runWithoutDbContext, type Db } from "@squadrail/db";
import { logger } from "./logger.js";

class RlsRequestRollback extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RlsRequestRollback";
  }
}

function isExpectedRollback(error: unknown) {
  return error instanceof RlsRequestRollback;
}

function serializeCompanyIds(actor: Request["actor"]) {
  if (actor.type === "agent") return actor.companyId ? [actor.companyId] : [];
  if (actor.type === "board") return actor.companyIds ?? [];
  return [];
}

function resolveActorIdentity(actor: Request["actor"]) {
  if (actor.type === "agent") {
    return {
      actorType: "agent",
      actorId: actor.agentId ?? "",
      canCreateCompany: false,
      isInstanceAdmin: false,
    };
  }
  if (actor.type === "board") {
    return {
      actorType: "board",
      actorId: actor.userId ?? "",
      canCreateCompany: actor.source === "local_implicit" || Boolean(actor.isInstanceAdmin),
      isInstanceAdmin: actor.source === "local_implicit" || Boolean(actor.isInstanceAdmin),
    };
  }
  return {
    actorType: "none",
    actorId: "",
    canCreateCompany: false,
    isInstanceAdmin: false,
  };
}

export function rlsRequestContextMiddleware(db: Db, opts: { enabled: boolean }): RequestHandler {
  if (!opts.enabled) {
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    const companyIds = serializeCompanyIds(req.actor);
    const identity = resolveActorIdentity(req.actor);
    const afterCommitCallbacks: Array<() => void | Promise<void>> = [];

    void db.transaction(async (tx) => {
      await tx.execute(sql`
        select
          set_config('app.company_ids', ${JSON.stringify(companyIds)}, true),
          set_config('app.is_instance_admin', ${identity.isInstanceAdmin ? "true" : "false"}, true),
          set_config('app.actor_type', ${identity.actorType}, true),
          set_config('app.actor_id', ${identity.actorId}, true),
          set_config('app.can_create_company', ${identity.canCreateCompany ? "true" : "false"}, true)
      `);
      await tx.execute(sql.raw("set local role squadrail_app_rls"));

      await runWithDbContext(tx as unknown as Db, async () => {
        await new Promise<void>((resolve, reject) => {
          let finished = false;
          const cleanup = () => {
            res.off("finish", onFinish);
            res.off("close", onClose);
          };
          const onFinish = () => {
            if (finished) return;
            finished = true;
            cleanup();
            if (res.statusCode >= 400) {
              reject(new RlsRequestRollback(`response finished with status ${res.statusCode}`));
              return;
            }
            resolve();
          };
          const onClose = () => {
            if (finished) return;
            finished = true;
            cleanup();
            reject(new RlsRequestRollback("response closed before completion"));
          };

          res.once("finish", onFinish);
          res.once("close", onClose);
          next();
        });
      }, { afterCommitCallbacks });
    }).then(async () => {
      if (afterCommitCallbacks.length === 0) return;
      await runWithoutDbContext(async () => {
        for (const callback of afterCommitCallbacks) {
          try {
            await callback();
          } catch (error) {
            logger.error({ err: error }, "after-commit callback failed");
          }
        }
      });
    }).catch((error) => {
      if (isExpectedRollback(error)) return;
      if (res.headersSent) return;
      next(error);
    });
  };
}
