export type ApiErrorCode =
  | "conflict"
  | "forbidden"
  | "invalid_request"
  | "method_not_allowed"
  | "not_found"
  | "not_implemented"
  | "unauthorized"
  | "unexpected_error";

export function requestId(request: Request): string {
  return request.headers.get("cf-ray") ?? crypto.randomUUID();
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function apiError(
  request: Request,
  status: number,
  code: ApiErrorCode,
  message: string,
  headers?: HeadersInit,
): Response {
  return Response.json(
    {
      error: {
        code,
        message,
        request_id: requestId(request),
      },
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...headers,
      },
    },
  );
}

export function notImplemented(request: Request): Response {
  return apiError(
    request,
    501,
    "not_implemented",
    "This API endpoint has not been implemented yet.",
  );
}
