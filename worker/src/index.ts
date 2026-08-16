import { routeRequest } from "./router";
import { apiError } from "./responses";
import { consumeNotificationBatch } from "./email/consumer";
import type { NotificationMessage } from "./email/messages";

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "unhandled_request_error",
          error: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      return apiError(
        request,
        500,
        "unexpected_error",
        "An unexpected error occurred.",
      );
    }
  },

  async queue(batch, env): Promise<void> {
    await consumeNotificationBatch(batch, env);
  },
} satisfies ExportedHandler<Env, NotificationMessage>;
