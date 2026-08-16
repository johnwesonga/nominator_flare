import type { VotingEmail } from "./templates";

export class EmailSendError extends Error {
  constructor(
    readonly retryable: boolean,
    readonly operationalCode: string,
  ) {
    super("Email provider request failed.");
    this.name = "EmailSendError";
  }
}

export async function sendWithResend(options: {
  apiKey: string;
  email: VotingEmail;
  fromEmail: string;
  fromName: string;
  idempotencyKey: string;
  to: string;
}): Promise<string> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": options.idempotencyKey,
    },
    body: JSON.stringify({
      from: `${options.fromName} <${options.fromEmail}>`,
      to: [options.to],
      subject: options.email.subject,
      html: options.email.html,
      text: options.email.text,
    }),
  });

  if (!response.ok) {
    await discardBoundedBody(response, 8 * 1024);
    throw new EmailSendError(
      response.status === 429 || response.status >= 500,
      `resend_http_${response.status}`,
    );
  }

  const value = await readBoundedJson(response, 8 * 1024);
  const id = typeof value === "object" && value !== null
    ? Reflect.get(value, "id")
    : null;
  if (
    typeof value !== "object" ||
    value === null ||
    typeof id !== "string"
  ) {
    throw new EmailSendError(true, "resend_invalid_response");
  }
  return id;
}

async function discardBoundedBody(response: Response, maximumBytes: number): Promise<void> {
  const reader = response.body?.getReader();
  if (reader === undefined) return;
  let bytes = 0;
  try {
    while (bytes <= maximumBytes) {
      const chunk = await reader.read();
      if (chunk.done) return;
      bytes += chunk.value.byteLength;
    }
  } finally {
    await reader.cancel();
  }
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new EmailSendError(true, "resend_empty_response");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) {
        throw new EmailSendError(true, "resend_response_too_large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }

  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new EmailSendError(true, "resend_invalid_response");
  }
}
