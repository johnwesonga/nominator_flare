import type { AdminIdentity } from "../auth";
import type { NotificationMessage } from "../email/messages";
import { isUuid } from "../request";
import { apiError, jsonResponse } from "../responses";

type CampaignRow = {
  id: string;
  status: "queued" | "sending" | "completed" | "failed";
  total: number;
  queued: number;
  sent: number;
  failed: number;
};

type FamilyIdRow = { family_id: string };

export async function handleNotificationRoute(
  request: Request,
  env: Env,
  identity?: AdminIdentity,
): Promise<Response> {
  if (identity === undefined) {
    throw new Error("Notification route called without an authorized identity.");
  }

  if (request.method === "POST") return startCampaign(request, env, identity);

  const encodedId = new URL(request.url).pathname.split("/").at(-1) ?? "";
  let campaignId: string;
  try {
    campaignId = decodeURIComponent(encodedId);
  } catch {
    return apiError(request, 400, "invalid_request", "Invalid campaign ID.");
  }
  if (!isUuid(campaignId)) {
    return apiError(request, 400, "invalid_request", "Invalid campaign ID.");
  }

  const campaign = await readCampaign(env.DB, campaignId);
  if (campaign === null) {
    return apiError(request, 404, "not_found", "Notification campaign not found.");
  }
  return jsonResponse(campaign);
}

async function startCampaign(
  request: Request,
  env: Env,
  identity: AdminIdentity,
): Promise<Response> {
  validateCampaignConfig(env);

  let campaign = await campaignForKey(env.DB, env.NOTIFICATION_CAMPAIGN_KEY);
  if (campaign === null) {
    const active = await env.DB
      .prepare(
        `SELECT id, status, total, queued, sent, failed
        FROM notification_campaigns
        WHERE status IN ('queued', 'sending') LIMIT 1`,
      )
      .first<CampaignRow>();
    if (active !== null) {
      return apiError(
        request,
        409,
        "conflict",
        "Another notification campaign is already active.",
      );
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const familyCount = await env.DB
      .prepare("SELECT COUNT(*) AS total FROM families")
      .first<{ total: number }>();
    const total = familyCount?.total ?? 0;
    const status = total === 0 ? "completed" : "queued";

    try {
      await env.DB.batch([
        env.DB
          .prepare(
            `INSERT INTO notification_campaigns (
              id, created_by, created_at, status, total, queued, sent, failed
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?5, 0, 0)`,
          )
          .bind(id, identity.email, now, status, total),
        env.DB
          .prepare(
            `INSERT INTO notification_campaign_keys (campaign_key, campaign_id)
            VALUES (?1, ?2)`,
          )
          .bind(env.NOTIFICATION_CAMPAIGN_KEY, id),
        env.DB
          .prepare(
            `INSERT INTO notification_deliveries (
              campaign_id, family_id, status, attempts, updated_at
            ) SELECT ?1, id, 'queued', 0, ?2 FROM families`,
          )
          .bind(id, now),
      ]);
    } catch (error) {
      campaign = await campaignForKey(env.DB, env.NOTIFICATION_CAMPAIGN_KEY);
      if (campaign === null) throw error;
    }
    campaign ??= await readCampaign(env.DB, id);
  }

  if (campaign === null) throw new Error("Notification campaign creation failed.");
  if (campaign.status === "queued" || campaign.status === "sending") {
    await enqueueOutstanding(env, campaign.id);
  }
  return jsonResponse(campaign, 202);
}

async function enqueueOutstanding(env: Env, campaignId: string): Promise<void> {
  const deliveries = await env.DB
    .prepare(
      `SELECT family_id FROM notification_deliveries
      WHERE campaign_id = ?1 AND status IN ('queued', 'sending')
      ORDER BY family_id`,
    )
    .bind(campaignId)
    .all<FamilyIdRow>();

  const messages: MessageSendRequest<NotificationMessage>[] = deliveries.results.map(
    ({ family_id }) => ({
      body: { campaignId, familyId: family_id },
      contentType: "json",
    }),
  );
  for (let offset = 0; offset < messages.length; offset += 100) {
    await env.EMAIL_QUEUE.sendBatch(messages.slice(offset, offset + 100));
  }
}

async function campaignForKey(
  database: D1Database,
  campaignKey: string,
): Promise<CampaignRow | null> {
  return database
    .prepare(
      `SELECT c.id, c.status, c.total, c.queued, c.sent, c.failed
      FROM notification_campaign_keys k
      JOIN notification_campaigns c ON c.id = k.campaign_id
      WHERE k.campaign_key = ?1`,
    )
    .bind(campaignKey)
    .first<CampaignRow>();
}

function readCampaign(
  database: D1Database,
  campaignId: string,
): Promise<CampaignRow | null> {
  return database
    .prepare(
      `SELECT id, status, total, queued, sent, failed
      FROM notification_campaigns WHERE id = ?1`,
    )
    .bind(campaignId)
    .first<CampaignRow>();
}

function validateCampaignConfig(env: Env): void {
  if (
    env.NOTIFICATION_CAMPAIGN_KEY.trim() === "" ||
    env.SENDER_EMAIL.endsWith("@replace-me.example.com") ||
    env.RESEND_API_KEY.trim() === ""
  ) {
    throw new Error("Notification configuration is incomplete.");
  }
}
