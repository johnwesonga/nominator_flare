import { apiError } from "./responses";

const MAX_JSON_BODY_BYTES = 4096;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function pathSegment(request: Request, index: number): string | null {
  const encoded = new URL(request.url).pathname.split("/")[index];
  if (encoded === undefined) return null;

  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

type JsonResult =
  | { ok: true; value: unknown }
  | { ok: false; response: Response };

export async function readBoundedJson(request: Request): Promise<JsonResult> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return {
      ok: false,
      response: apiError(
        request,
        400,
        "invalid_request",
        "Content-Type must be application/json.",
      ),
    };
  }

  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    Number.parseInt(contentLength, 10) > MAX_JSON_BODY_BYTES
  ) {
    return tooLarge(request);
  }

  if (request.body === null) return invalidJson(request);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_JSON_BODY_BYTES) {
      await reader.cancel();
      return tooLarge(request);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return invalidJson(request);
  }
}

function invalidJson(request: Request): JsonResult {
  return {
    ok: false,
    response: apiError(
      request,
      400,
      "invalid_request",
      "The request body must be valid JSON.",
    ),
  };
}

function tooLarge(request: Request): JsonResult {
  return {
    ok: false,
    response: apiError(
      request,
      400,
      "invalid_request",
      "The request body is too large.",
    ),
  };
}
