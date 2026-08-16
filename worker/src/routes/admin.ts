import type { AdminIdentity } from "../auth";
import { readBoundedJson } from "../request";
import { apiError, jsonResponse } from "../responses";

type AdminRosterRow = {
  family_id: string;
  family_email: string;
  family_token: string;
  swimmer_id: string;
  swimmer_name: string;
  group_name: string | null;
  has_voted: number;
};

type ResultRow = {
  candidate_id: string;
  candidate_name: string;
  vote_count: number;
};

export async function handleAdminRoute(
  request: Request,
  env: Env,
  identity?: AdminIdentity,
): Promise<Response> {
  if (identity === undefined) {
    throw new Error("Admin route called without an authorized identity.");
  }

  switch (new URL(request.url).pathname) {
    case "/api/admin/session":
      return jsonResponse({ email: identity.email });
    case "/api/admin/roster":
      return roster(env.DB);
    case "/api/admin/results":
      return results(env.DB);
    case "/api/admin/voting":
      return updateVoting(request, env.DB, identity);
    default:
      throw new Error("Router dispatched an unknown admin route.");
  }
}

async function roster(database: D1Database): Promise<Response> {
  const result = await database
    .prepare(
      `SELECT
        family_id, family_email, family_token, swimmer_id, swimmer_name,
        group_name, has_voted
      FROM admin_roster
      ORDER BY COALESCE(group_name, ''), family_email, swimmer_name, swimmer_id`,
    )
    .all<AdminRosterRow>();

  return jsonResponse(
    result.results.map((row) => ({
      family_id: row.family_id,
      family_email: row.family_email,
      family_token: row.family_token,
      swimmer_id: row.swimmer_id,
      swimmer_name: row.swimmer_name,
      group_name: row.group_name,
      has_voted: row.has_voted === 1,
    })),
  );
}

async function results(database: D1Database): Promise<Response> {
  const result = await database
    .prepare(
      `SELECT candidate_id, candidate_name, vote_count
      FROM vote_results
      ORDER BY vote_count DESC, candidate_name COLLATE NOCASE, candidate_id`,
    )
    .all<ResultRow>();

  return jsonResponse(result.results);
}

async function updateVoting(
  request: Request,
  database: D1Database,
  identity: AdminIdentity,
): Promise<Response> {
  const json = await readBoundedJson(request);
  if (!json.ok) return json.response;

  const open = parseOpen(json.value);
  if (open === null) {
    return apiError(
      request,
      400,
      "invalid_request",
      "open must be a boolean.",
    );
  }

  const now = new Date().toISOString();
  const [result] = await database.batch([
    database
      .prepare(
      `UPDATE voting_settings
      SET is_open = ?1,
          closed_at = CASE WHEN ?1 = 1 THEN NULL ELSE ?2 END,
          updated_at = ?2,
          updated_by = ?3
      WHERE id = 1`,
      )
      .bind(open ? 1 : 0, now, identity.email),
    database
      .prepare(
        `INSERT INTO admin_audit_events (
          id, actor_email, event_type, created_at
        ) VALUES (?1, ?2, ?3, ?4)`,
      )
      .bind(
        crypto.randomUUID(),
        identity.email,
        open ? "voting_opened" : "voting_closed",
        now,
      ),
  ]);

  if (result === undefined || result.meta.changes !== 1) {
    throw new Error("Voting settings singleton is missing.");
  }

  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}

function parseOpen(value: unknown): boolean | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const open = Reflect.get(value, "open");
  return typeof open === "boolean" ? open : null;
}
