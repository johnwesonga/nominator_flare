import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  reset,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeNotificationBatch } from "../src/email/consumer";
import type { NotificationMessage } from "../src/email/messages";
import { escapeHtml, votingEmail } from "../src/email/templates";
import { handleNotificationRoute } from "../src/routes/notifications";

const MANAGER_EMAIL = "manager@example.com";
const FAMILY_ID = "00000000-0000-4000-8000-000000000001";
const FAMILY_TOKEN = "10000000-0000-4000-8000-000000000001";
const SWIMMER_ID = "20000000-0000-4000-8000-000000000001";
const CAMPAIGN_ID = "30000000-0000-4000-8000-000000000001";
const CREATED_AT = "2026-08-14T00:00:00.000Z";

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.batch([
    env.DB
      .prepare("INSERT INTO admins (email, created_at) VALUES (?1, ?2)")
      .bind(MANAGER_EMAIL, CREATED_AT),
    env.DB
      .prepare(
        "INSERT INTO families (id, email, family_token, created_at) VALUES (?1, ?2, ?3, ?4)",
      )
      .bind(FAMILY_ID, "parent@example.com", FAMILY_TOKEN, CREATED_AT),
    env.DB
      .prepare(
        "INSERT INTO swimmers (id, family_id, name, group_name, created_at) VALUES (?1, ?2, ?3, NULL, ?4)",
      )
      .bind(SWIMMER_ID, FAMILY_ID, "Ada <Example>", CREATED_AT),
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

describe("notification campaign API", () => {
  it("creates one delivery per family and reuses the configured campaign key", async () => {
    const first = await startCampaign();
    expect(first.status).toBe(202);
    const firstBody = await campaignBody(first);
    expect(firstBody).toMatchObject({
      status: "queued",
      total: 1,
      queued: 1,
      sent: 0,
      failed: 0,
    });

    const second = await startCampaign();
    expect(second.status).toBe(202);
    expect((await campaignBody(second)).id).toBe(firstBody.id);

    const counts = await env.DB
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM notification_campaigns) AS campaigns,
          (SELECT COUNT(*) FROM notification_campaign_keys) AS campaign_keys,
          (SELECT COUNT(*) FROM notification_deliveries) AS deliveries`,
      )
      .first<{ campaigns: number; campaign_keys: number; deliveries: number }>();
    expect(counts).toEqual({ campaigns: 1, campaign_keys: 1, deliveries: 1 });
  });

  it("returns campaign progress and rejects unknown IDs", async () => {
    const created = await campaignBody(await startCampaign());
    const response = await handleNotificationRoute(
      new Request(`https://example.test/api/admin/notifications/${created.id}`),
      env,
      { email: MANAGER_EMAIL, subject: "access-user-id" },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(created);

    const missing = await handleNotificationRoute(
      new Request(`https://example.test/api/admin/notifications/${CAMPAIGN_ID}`),
      env,
      { email: MANAGER_EMAIL, subject: "access-user-id" },
    );
    expect(missing.status).toBe(404);

    const malformed = await handleNotificationRoute(
      new Request("https://example.test/api/admin/notifications/not-a-uuid"),
      env,
      { email: MANAGER_EMAIL, subject: "access-user-id" },
    );
    expect(malformed.status).toBe(400);
  });
});

describe("notification queue consumer", () => {
  it("sends escaped HTML and text once, then completes the campaign", async () => {
    await seedCampaign();
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ id: "resend-message-1" }),
    );

    const result = await consume(1);
    expect(result.ackAll).toBe(false);
    expect(result.retryBatch).toBeDefined();
    expect(result.explicitAcks).toEqual(["queue-message-1"]);
    expect(result.retryMessages).toEqual([]);
    expect(send).toHaveBeenCalledOnce();

    const resendRequest = send.mock.calls[0]?.[1];
    const headers = new Headers(resendRequest?.headers);
    expect(headers.get("Idempotency-Key")).toBe(
      `notification_${CAMPAIGN_ID}_${FAMILY_ID}`,
    );
    const payload: unknown = JSON.parse(String(resendRequest?.body));
    expect(payload).toMatchObject({
      to: ["parent@example.com"],
      text: expect.stringContaining("Ada <Example>"),
      html: expect.stringContaining("Ada &lt;Example&gt;"),
    });

    const delivery = await deliveryState();
    expect(delivery).toEqual({
      status: "sent",
      attempts: 1,
      provider_message_id: "resend-message-1",
      last_error: null,
    });
    expect(await campaignState()).toEqual({
      status: "completed",
      queued: 0,
      sent: 1,
      failed: 0,
    });

    await consume(2);
    expect(send).toHaveBeenCalledOnce();
  });

  it("retries transient provider failures without decrementing queued", async () => {
    await seedCampaign();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("temporary", { status: 503 }));

    const result = await consume(1);
    expect(result.retryMessages).toEqual([{ msgId: "queue-message-1" }]);
    expect(await deliveryState()).toMatchObject({
      status: "sending",
      attempts: 1,
      last_error: "resend_http_503",
    });
    expect(await campaignState()).toEqual({
      status: "sending",
      queued: 1,
      sent: 0,
      failed: 0,
    });
  });

  it("records permanent provider failures and acknowledges them", async () => {
    await seedCampaign();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("invalid", { status: 422 }));

    const result = await consume(1);
    expect(result.explicitAcks).toEqual(["queue-message-1"]);
    expect(result.retryMessages).toEqual([]);
    expect(await deliveryState()).toMatchObject({
      status: "failed",
      attempts: 1,
      last_error: "resend_http_422",
    });
    expect(await campaignState()).toEqual({
      status: "failed",
      queued: 0,
      sent: 0,
      failed: 1,
    });
  });

  it("records final transient failure and retries it into the DLQ path", async () => {
    await seedCampaign();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("temporary", { status: 500 }));

    const result = await consume(4);
    expect(result.retryMessages).toEqual([{ msgId: "queue-message-1" }]);
    expect(await deliveryState()).toMatchObject({
      status: "failed",
      attempts: 4,
      last_error: "resend_http_500",
    });
  });
});

describe("email templates", () => {
  it("escapes every HTML-sensitive character and includes a plain-text URL", () => {
    expect(escapeHtml(`<&>'\"`)).toBe("&lt;&amp;&gt;&#39;&quot;");
    const email = votingEmail(["A < B", "C & D"], "https://example.test/vote/token");
    expect(email.html).toContain("A &lt; B and C &amp; D");
    expect(email.text).toContain("https://example.test/vote/token");
  });
});

async function startCampaign(): Promise<Response> {
  return handleNotificationRoute(
    new Request("https://example.test/api/admin/notifications", { method: "POST" }),
    env,
    { email: MANAGER_EMAIL, subject: "access-user-id" },
  );
}

async function campaignBody(response: Response): Promise<{
  id: string;
  status: string;
  total: number;
  queued: number;
  sent: number;
  failed: number;
}> {
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null) throw new Error("Invalid campaign body");
  const id = Reflect.get(value, "id");
  if (typeof id !== "string") throw new Error("Invalid campaign ID");
  return {
    id,
    status: String(Reflect.get(value, "status")),
    total: Number(Reflect.get(value, "total")),
    queued: Number(Reflect.get(value, "queued")),
    sent: Number(Reflect.get(value, "sent")),
    failed: Number(Reflect.get(value, "failed")),
  };
}

async function seedCampaign(): Promise<void> {
  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO notification_campaigns (
          id, created_by, created_at, status, total, queued, sent, failed
        ) VALUES (?1, ?2, ?3, 'queued', 1, 1, 0, 0)`,
      )
      .bind(CAMPAIGN_ID, MANAGER_EMAIL, CREATED_AT),
    env.DB
      .prepare(
        `INSERT INTO notification_deliveries (
          campaign_id, family_id, status, attempts, updated_at
        ) VALUES (?1, ?2, 'queued', 0, ?3)`,
      )
      .bind(CAMPAIGN_ID, FAMILY_ID, CREATED_AT),
  ]);
}

async function consume(attempts: number) {
  const body: NotificationMessage = { campaignId: CAMPAIGN_ID, familyId: FAMILY_ID };
  const batch = createMessageBatch<NotificationMessage>("nominator-email-development", [
    {
      id: "queue-message-1",
      timestamp: new Date(CREATED_AT),
      attempts,
      body,
    },
  ]);
  const context = createExecutionContext();
  await consumeNotificationBatch(batch, env);
  return getQueueResult(batch, context);
}

function deliveryState() {
  return env.DB
    .prepare(
      `SELECT status, attempts, provider_message_id, last_error
      FROM notification_deliveries WHERE campaign_id = ?1 AND family_id = ?2`,
    )
    .bind(CAMPAIGN_ID, FAMILY_ID)
    .first<{
      status: string;
      attempts: number;
      provider_message_id: string | null;
      last_error: string | null;
    }>();
}

function campaignState() {
  return env.DB
    .prepare(
      `SELECT status, queued, sent, failed FROM notification_campaigns WHERE id = ?1`,
    )
    .bind(CAMPAIGN_ID)
    .first<{ status: string; queued: number; sent: number; failed: number }>();
}
