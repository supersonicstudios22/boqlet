import type { Middleware } from "openapi-fetch";
import type { ApiErrorBody } from "@ifc-boq/api";

/**
 * Every failed API call becomes one `ApiError` (docs/architecture/frontend.md, data layer rule 6).
 * `status` 0 means the request never got an answer (network down, server not running).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  /** The whole error body, for errors that carry more than `details` (e.g. `SessionConflict`). */
  readonly body: unknown;
  /** The answer's `X-Request-Id`: shown with a server error so a screenshot leads to the log line (TF-185). */
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>, body?: unknown, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.body = body;
    this.requestId = requestId;
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    let body: Partial<ApiErrorBody> | undefined;
    try {
      body = (await response.clone().json()) as Partial<ApiErrorBody>;
    } catch {
      body = undefined;
    }
    return new ApiError(
      response.status,
      body?.code ?? `http_${response.status}`,
      body?.message ?? response.statusText ?? "",
      body?.details as Record<string, unknown> | undefined,
      body,
      response.headers.get("X-Request-Id") ?? undefined,
    );
  }

  static network(cause: unknown): ApiError {
    const error = new ApiError(0, "network", cause instanceof Error ? cause.message : String(cause));
    return error;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** The request id worth showing with an error: a server failure's (5xx), not a refusal's. */
export function errorReference(error: unknown): string | undefined {
  return isApiError(error) && error.status >= 500 && !isUnavailable(error) ? error.requestId : undefined;
}

/**
 * The API could not be reached or is restarting (a deploy, TF-183): no answer, a gateway's 502/503/504,
 * or the dev proxy's `api_unavailable`. Worth retrying; nothing was refused.
 */
export function isUnavailable(error: unknown): boolean {
  return isApiError(error) && (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504 || error.code === "api_unavailable");
}

/** openapi-fetch middleware: throw an `ApiError` for every non-2xx answer (redirects pass). */
export const throwOnApiError: Middleware = {
  async onResponse({ response }) {
    if (response.status >= 400) throw await ApiError.fromResponse(response);
    return response;
  },
  onError({ error }) {
    if (error instanceof ApiError) return error;
    return ApiError.network(error);
  },
};
