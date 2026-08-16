export type Family = {
  email: string;
  family_token: string;
  swimmers: Array<{ name: string }>;
};

export type Email = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
};

export type Dependencies = {
  fromAddress: string;
  voteBaseUrl: string;
  isAdmin: (authHeader: string) => Promise<boolean>;
  listFamilies: () => Promise<Family[]>;
  sendBatch: (emails: Email[]) => Promise<boolean>;
};

const BATCH_SIZE = 100;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function createEmail(family: Family, deps: Dependencies): Email {
  const link = `${deps.voteBaseUrl}/${family.family_token}`;
  const childNames = family.swimmers.map(({ name }) => name).join(", ");
  const safeNames = escapeHtml(childNames);
  const safeLink = escapeHtml(link);
  return {
    from: deps.fromAddress,
    to: [family.email],
    subject: "Vote now: Most Inspirational Swimmer",
    html: `<p>Hi there,</p>
<p>Voting for this season's <strong>Most Inspirational Swimmer</strong> is open.
Please cast a vote for each of your swimmer(s) — <strong>${safeNames}</strong> —
using your family's link below. Each swimmer gets one vote, and it can't be
changed once submitted, so take your time:</p>
<p><a href="${safeLink}">${safeLink}</a></p>
<p>Thanks for a great season!</p>`,
    text: `Hi there,

Voting for this season's Most Inspirational Swimmer is open. Please cast a vote for each of your swimmer(s) — ${childNames} — using your family's link below. Each swimmer gets one vote, and it can't be changed once submitted.

${link}

Thanks for a great season!`,
  };
}

export function createNotifyParentsHandler(
  deps: Dependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "method not allowed" }, 405);
    }

    const authHeader = request.headers.get("Authorization") ?? "";
    if (!(await deps.isAdmin(authHeader))) {
      return jsonResponse({ error: "not authorized" }, 403);
    }

    let families: Family[];
    try {
      families = await deps.listFamilies();
    } catch (error) {
      const message = error instanceof Error ? error.message : "database error";
      return jsonResponse({ error: message }, 500);
    }

    const emails = families.map((family) => createEmail(family, deps));
    let sent = 0;
    let failed = 0;
    for (const batch of chunk(emails, BATCH_SIZE)) {
      try {
        if (await deps.sendBatch(batch)) sent += batch.length;
        else failed += batch.length;
      } catch {
        failed += batch.length;
      }
    }
    return jsonResponse({ sent, failed }, failed === 0 ? 200 : 502);
  };
}
