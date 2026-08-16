import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createNotifyParentsHandler } from "./handler.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const handler = createNotifyParentsHandler({
  fromAddress: "Team Voting <onboarding@resend.dev>",
  voteBaseUrl: "http://localhost:3333/vote",
  async isAdmin(authHeader) {
    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error } = await caller.rpc("is_admin");
    return !error && data === true;
  },
  async listFamilies() {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data, error } = await admin
      .from("families")
      .select("email, family_token, swimmers(name)");
    if (error) throw new Error(error.message);
    return data ?? [];
  },
  async sendBatch(emails) {
    const response = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emails),
    });
    if (!response.ok) {
      console.error("Resend rejected the batch:", await response.text());
    }
    return response.ok;
  },
});

Deno.serve(handler);
