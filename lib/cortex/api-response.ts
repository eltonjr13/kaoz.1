export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  [key: string]: unknown; // Allows backward compatibility aliases at root level
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorPayload;
  message?: string; // Optional mirror for legacy clients inspecting .message
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export const ApiErrorCode = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_PARAMETERS: 'INVALID_PARAMETERS',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  STORAGE_ERROR: 'STORAGE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCodeType = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export function apiSuccess<T>(
  data: T,
  status = 200,
  legacyAliases?: Record<string, unknown>
): Response {
  const payload: Record<string, unknown> = {
    success: true,
    data,
    ...(legacyAliases || {}),
  };
  return Response.json(payload, { status });
}

export function apiError(
  code: ApiErrorCodeType,
  message: string,
  status = 400,
  details?: unknown
): Response {
  const payload: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
    message, // Backwards compatibility for callers expecting root-level message
  };
  return Response.json(payload, { status });
}
