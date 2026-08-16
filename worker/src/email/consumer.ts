import { EmailSendError, sendWithResend } from "./resend";
import { parseNotificationMessage, type NotificationMessage } from "./messages";
import { votingEmail } from "./templates";

const FINAL_ATTEMPT = 4;

type FamilyRow = { email: string; family_token: string };
type SwimmerRow = { name: string };
type DeliveryRow = { status: string };

export async function consumeNotificationBatch(
  batch: MessageBatch<NotificationMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    const body = parseNotificationMessage(message.body);
    if (body === null) {
      console.error(JSON.stringify({ event: "notification_message_invalid" }));
      message.ack();
      continue;
    }

    try {
      const outcome = await deliver(body, message.attempts, env);
      if (outcome === "retry") {
        message.retry({ delaySeconds: retryDelay(message.attempts) });
      } else {
        message.ack();
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "notification_delivery_error",
          error: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      if (message.attempts >= FINAL_ATTEMPT) {
        try {
          await finishDelivery(
            env.DB,
            body,
            "failed",
            message.attempts,
            null,
            "consumer_error",
          );
        } catch (recordingError) {
          console.error(
            JSON.stringify({
              event: "notification_terminal_state_error",
              error: recordingError instanceof Error
                ? recordingError.name
                : "UnknownError",
            }),
          );
        }
      }
      message.retry({ delaySeconds: retryDelay(message.attempts) });
    }
  }
}

async function deliver(
  message: NotificationMessage,
  attempts: number,
  env: Env,
): Promise<"ack" | "retry"> {
  const delivery = await env.DB
    .prepare(
      `SELECT status FROM notification_deliveries
      WHERE campaign_id = ?1 AND family_id = ?2`,
    )
    .bind(message.campaignId, message.familyId)
    .first<DeliveryRow>();

  if (delivery === null || delivery.status === "sent" || delivery.status === "failed") {
    return "ack";
  }

  const family = await env.DB
    .prepare("SELECT email, family_token FROM families WHERE id = ?1")
    .bind(message.familyId)
    .first<FamilyRow>();
  if (family === null) {
    await finishDelivery(env.DB, message, "failed", attempts, null, "family_missing");
    return "ack";
  }

  const swimmers = await env.DB
    .prepare("SELECT name FROM swimmers WHERE family_id = ?1 ORDER BY name COLLATE NOCASE, id")
    .bind(message.familyId)
    .all<SwimmerRow>();

  await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE notification_deliveries
        SET status = 'sending', attempts = ?3, last_error = NULL, updated_at = ?4
        WHERE campaign_id = ?1 AND family_id = ?2 AND status IN ('queued', 'sending')`,
      )
      .bind(message.campaignId, message.familyId, attempts, new Date().toISOString()),
    env.DB
      .prepare(
        `UPDATE notification_campaigns SET status = 'sending'
        WHERE id = ?1 AND status = 'queued'`,
      )
      .bind(message.campaignId),
  ]);

  try {
    const origin = validatedOrigin(env.APPLICATION_ORIGIN);
    validatedSender(env.SENDER_EMAIL);
    validatedSenderName(env.SENDER_NAME);
    const content = votingEmail(
      swimmers.results.map(({ name }) => name),
      `${origin}/vote/${encodeURIComponent(family.family_token)}`,
    );
    const providerId = await sendWithResend({
      apiKey: env.RESEND_API_KEY,
      email: content,
      fromEmail: env.SENDER_EMAIL,
      fromName: env.SENDER_NAME,
      idempotencyKey: `notification_${message.campaignId}_${message.familyId}`,
      to: family.email,
    });
    await finishDelivery(env.DB, message, "sent", attempts, providerId, null);
    console.log(JSON.stringify({ event: "notification_delivery_sent" }));
    return "ack";
  } catch (error) {
    const emailError = error instanceof EmailSendError ? error : null;
    const terminal = emailError?.retryable === false || attempts >= FINAL_ATTEMPT;
    if (terminal) {
      await finishDelivery(
        env.DB,
        message,
        "failed",
        attempts,
        null,
        emailError?.operationalCode ?? "email_provider_error",
      );
      console.error(JSON.stringify({ event: "notification_delivery_failed" }));
      return attempts >= FINAL_ATTEMPT && emailError?.retryable !== false
        ? "retry"
        : "ack";
    }

    await env.DB
      .prepare(
        `UPDATE notification_deliveries
        SET attempts = ?3, last_error = ?4, updated_at = ?5
        WHERE campaign_id = ?1 AND family_id = ?2 AND status = 'sending'`,
      )
      .bind(
        message.campaignId,
        message.familyId,
        attempts,
        emailError?.operationalCode ?? "email_provider_error",
        new Date().toISOString(),
      )
      .run();
    return "retry";
  }
}

async function finishDelivery(
  database: D1Database,
  message: NotificationMessage,
  status: "sent" | "failed",
  attempts: number,
  providerId: string | null,
  lastError: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `UPDATE notification_deliveries
        SET status = ?3, provider_message_id = ?4, attempts = ?5,
            last_error = ?6, updated_at = ?7
        WHERE campaign_id = ?1 AND family_id = ?2 AND status != 'sent'`,
      )
      .bind(
        message.campaignId,
        message.familyId,
        status,
        providerId,
        attempts,
        lastError,
        now,
      ),
    database
      .prepare(
        `UPDATE notification_campaigns
        SET sent = (
              SELECT COUNT(*) FROM notification_deliveries
              WHERE campaign_id = ?1 AND status = 'sent'
            ),
            failed = (
              SELECT COUNT(*) FROM notification_deliveries
              WHERE campaign_id = ?1 AND status = 'failed'
            ),
            queued = total - (
              SELECT COUNT(*) FROM notification_deliveries
              WHERE campaign_id = ?1 AND status IN ('sent', 'failed')
            ),
            status = CASE
              WHEN NOT EXISTS (
                SELECT 1 FROM notification_deliveries
                WHERE campaign_id = ?1 AND status NOT IN ('sent', 'failed')
              ) THEN CASE
                WHEN EXISTS (
                  SELECT 1 FROM notification_deliveries
                  WHERE campaign_id = ?1 AND status = 'failed'
                ) THEN 'failed'
                ELSE 'completed'
              END
              ELSE 'sending'
            END
        WHERE id = ?1`,
      )
      .bind(message.campaignId),
  ]);
}

function validatedOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("APPLICATION_ORIGIN must use HTTPS outside localhost.");
  }
  return url.origin;
}

function validatedSender(value: string): void {
  if (value.endsWith("@replace-me.example.com") || !value.includes("@")) {
    throw new Error("SENDER_EMAIL is not configured.");
  }
}

function validatedSenderName(value: string): void {
  if (value.trim() === "" || /[\r\n<>]/.test(value)) {
    throw new Error("SENDER_NAME is not configured safely.");
  }
}

function retryDelay(attempts: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempts - 1), 900);
}
