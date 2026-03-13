import { ZodError, z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../errors.js";

const { mockLoggerError } = vi.hoisted(() => ({
  mockLoggerError: vi.fn(),
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    error: mockLoggerError,
  },
}));

import { errorHandler } from "../middleware/error-handler.js";

function createResponse() {
  const state = { statusCode: 200, body: undefined as unknown, locals: {} as Record<string, unknown> };
  return {
    state,
    res: {
      locals: state.locals,
      status(code: number) {
        state.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        state.body = payload;
        return this;
      },
    },
  };
}

describe("error handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns explicit HttpError payloads without logging", () => {
    const { res, state } = createResponse();

    errorHandler(new HttpError(409, "Conflict", { field: "name" }), {
      method: "PATCH",
      originalUrl: "/api/test",
    } as never, res as never, vi.fn());

    expect(state.statusCode).toBe(409);
    expect(state.body).toEqual({
      error: "Conflict",
      details: { field: "name" },
    });
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("maps Zod validation errors to 400 responses", () => {
    const { res, state } = createResponse();
    const schema = z.object({ name: z.string().min(2) });
    const parsed = schema.safeParse({ name: "" });
    expect(parsed.success).toBe(false);
    const err = parsed.success ? null : parsed.error;

    errorHandler(err as ZodError, {
      method: "POST",
      originalUrl: "/api/test",
    } as never, res as never, vi.fn());

    expect(state.statusCode).toBe(400);
    expect(state.body).toEqual({
      error: "Validation error",
      details: expect.any(Array),
    });
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("logs unexpected errors and exposes a generic 500 response", () => {
    const { res, state } = createResponse();
    const err = new Error("boom");

    errorHandler(err, {
      method: "GET",
      originalUrl: "/api/test",
    } as never, res as never, vi.fn());

    expect(state.statusCode).toBe(500);
    expect(state.body).toEqual({ error: "Internal server error" });
    expect(state.locals.serverError).toEqual({
      message: "boom",
      stack: err.stack,
      name: "Error",
    });
    expect(mockLoggerError).toHaveBeenCalledWith(
      {
        err: expect.objectContaining({ message: "boom", name: "Error" }),
        method: "GET",
        url: "/api/test",
      },
      "Unhandled error: %s %s — %s",
      "GET",
      "/api/test",
      "boom",
    );
  });
});
