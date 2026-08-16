import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

process.env.RESEND_API_KEY ??= "re_test_only";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        bindings: {
          ACCESS_AUD: "test-access-audience",
          ACCESS_TEAM_DOMAIN: "https://access.example.test",
          APPLICATION_ORIGIN: "https://nominator.example.test",
          NOTIFICATION_CAMPAIGN_KEY: "test-2026-most-inspirational",
          RESEND_API_KEY: "re_test_only",
          SENDER_EMAIL: "voting@example.test",
          TEST_MIGRATIONS: await readD1Migrations("d1/migrations"),
        },
      },
      wrangler: { configPath: "./wrangler.jsonc" },
    })),
  ],
});
