import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "@/src/lib/logger";
import { AppError } from "./errors";

export type RouteHandler = (request: Request) => Promise<Response> | Response;

export function withErrorHandler(handler: RouteHandler): RouteHandler {
  return async (request) => {
    const requestId = request.headers.get("x-request-id") ?? randomUUID();
    try {
      const response = await handler(request);
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (error) {
      const known = error instanceof AppError;
      const validation = error instanceof ZodError;
      const status = known ? error.status : validation ? 400 : 500;
      const code = known
        ? error.code
        : validation
          ? "VALIDATION_ERROR"
          : "INTERNAL_ERROR";
      const message =
        status === 500
          ? "An unexpected error occurred"
          : (error as Error).message;

      logger[status >= 500 ? "error" : "warn"](
        { err: error, requestId, method: request.method, url: request.url },
        message,
      );

      return NextResponse.json(
        {
          error: {
            code,
            message,
            ...(known && error.details ? { details: error.details } : {}),
            requestId,
          },
        },
        { status, headers: { "x-request-id": requestId } },
      );
    }
  };
}
