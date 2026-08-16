import type { AdminIdentity } from "../auth";
import { isUuid, pathSegment, readBoundedJson } from "../request";
import { apiError, jsonResponse } from "../responses";

type FamilyRow = {
  id: string;
  email: string;
  family_token: string;
  created_at: string;
  swimmer_id: string | null;
  swimmer_name: string | null;
  group_name: string | null;
  swimmer_created_at: string | null;
  has_voted: number | null;
};

type FamilyResponse = {
  id: string;
  email: string;
  family_token: string;
  created_at: string;
  swimmers: SwimmerResponse[];
};

type SwimmerResponse = {
  id: string;
  name: string;
  group_name: string | null;
  created_at: string;
  has_voted: boolean;
};

type FamilyInput = { email: string };
type SwimmerInput = { name: string; groupName: string | null };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleFamilyManagementRoute(
  request: Request,
  env: Env,
  identity?: AdminIdentity,
): Promise<Response> {
  if (identity === undefined) {
    throw new Error("Family route called without an authorized identity.");
  }

  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/admin/families") {
    return request.method === "GET"
      ? listFamilies(env.DB)
      : createFamily(request, env.DB, identity);
  }
  if (pathname.endsWith("/swimmers")) {
    return createSwimmer(request, env.DB, identity);
  }
  if (pathname.startsWith("/api/admin/swimmers/")) {
    return request.method === "PUT"
      ? updateSwimmer(request, env.DB, identity)
      : deleteSwimmer(request, env.DB, identity);
  }
  return request.method === "PUT"
    ? updateFamily(request, env.DB, identity)
    : deleteFamily(request, env.DB, identity);
}

async function listFamilies(database: D1Database): Promise<Response> {
  const result = await database
    .prepare(
      `SELECT
        f.id, f.email, f.family_token, f.created_at,
        s.id AS swimmer_id, s.name AS swimmer_name, s.group_name,
        s.created_at AS swimmer_created_at,
        EXISTS (SELECT 1 FROM votes v WHERE v.voter_id = s.id) AS has_voted
      FROM families f
      LEFT JOIN swimmers s ON s.family_id = f.id
      ORDER BY f.email COLLATE NOCASE, f.id, s.name COLLATE NOCASE, s.id`,
    )
    .all<FamilyRow>();

  const families = new Map<string, FamilyResponse>();
  for (const row of result.results) {
    let family = families.get(row.id);
    if (family === undefined) {
      family = {
        id: row.id,
        email: row.email,
        family_token: row.family_token,
        created_at: row.created_at,
        swimmers: [],
      };
      families.set(row.id, family);
    }
    if (
      row.swimmer_id !== null &&
      row.swimmer_name !== null &&
      row.swimmer_created_at !== null
    ) {
      family.swimmers.push({
        id: row.swimmer_id,
        name: row.swimmer_name,
        group_name: row.group_name,
        created_at: row.swimmer_created_at,
        has_voted: row.has_voted === 1,
      });
    }
  }
  return jsonResponse([...families.values()]);
}

async function createFamily(
  request: Request,
  database: D1Database,
  identity: AdminIdentity,
): Promise<Response> {
  const input = await familyInput(request);
  if (!input.ok) return input.response;

  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO families (id, email, family_token, created_at)
          VALUES (?1, ?2, ?3, ?4)`,
        )
        .bind(id, input.value.email, token, now),
      auditStatement(database, identity.email, "family_created", "family", id, now),
    ]);
  } catch {
    return apiError(request, 409, "conflict", "A family with that email already exists.");
  }
  return jsonResponse(
    { id, email: input.value.email, family_token: token, created_at: now, swimmers: [] },
    201,
  );
}

async function updateFamily(
  request: Request,
  database: D1Database,
  identity: AdminIdentity,
): Promise<Response> {
  const id = pathSegment(request, 4);
  if (!isUuid(id)) return invalidId(request, "family");
  const input = await familyInput(request);
  if (!input.ok) return input.response;
  if (!(await rowExists(database, "families", id))) return notFound(request, "Family");

  const duplicate = await database
    .prepare("SELECT 1 AS present FROM families WHERE email = ?1 AND id != ?2 LIMIT 1")
    .bind(input.value.email, id)
    .first();
  if (duplicate !== null) {
    return apiError(request, 409, "conflict", "A family with that email already exists.");
  }

  const now = new Date().toISOString();
  await database.batch([
    database.prepare("UPDATE families SET email = ?1 WHERE id = ?2").bind(input.value.email, id),
    auditStatement(database, identity.email, "family_updated", "family", id, now),
  ]);
  return familyById(database, id);
}

async function deleteFamily(
  request: Request,
  database: D1Database,
  identity: AdminIdentity,
): Promise<Response> {
  const id = pathSegment(request, 4);
  if (!isUuid(id)) return invalidId(request, "family");
  if (!(await rowExists(database, "families", id))) return notFound(request, "Family");
  const child = await database
    .prepare("SELECT 1 AS present FROM swimmers WHERE family_id = ?1 LIMIT 1")
    .bind(id)
    .first();
  if (child !== null) {
    return apiError(request, 409, "conflict", "Remove every swimmer before deleting this family.");
  }

  const now = new Date().toISOString();
  const results = await database.batch([
    auditStatement(database, identity.email, "family_deleted", "family", id, now),
    database.prepare(
      `DELETE FROM families
      WHERE id = ?1 AND NOT EXISTS (
        SELECT 1 FROM swimmers WHERE family_id = ?1
      )`,
    ).bind(id),
  ]);
  if (results[1]?.meta.changes !== 1) {
    return apiError(request, 409, "conflict", "The family could not be deleted safely.");
  }
  return noContent();
}

async function createSwimmer(
  request: Request,
  database: D1Database,
  identity: AdminIdentity,
): Promise<Response> {
  const familyId = pathSegment(request, 4);
  if (!isUuid(familyId)) return invalidId(request, "family");
  if (!(await rowExists(database, "families", familyId))) return notFound(request, "Family");
  const input = await swimmerInput(request);
  if (!input.ok) return input.response;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO swimmers (id, family_id, name, group_name, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(id, familyId, input.value.name, input.value.groupName, now),
    auditStatement(database, identity.email, "swimmer_created", "swimmer", id, now),
  ]);
  return jsonResponse(
    { id, name: input.value.name, group_name: input.value.groupName, created_at: now, has_voted: false },
    201,
  );
}

async function updateSwimmer(
  request: Request,
  database: D1Database,
  identity: AdminIdentity,
): Promise<Response> {
  const id = pathSegment(request, 4);
  if (!isUuid(id)) return invalidId(request, "swimmer");
  if (!(await rowExists(database, "swimmers", id))) return notFound(request, "Swimmer");
  const input = await swimmerInput(request);
  if (!input.ok) return input.response;
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare("UPDATE swimmers SET name = ?1, group_name = ?2 WHERE id = ?3")
      .bind(input.value.name, input.value.groupName, id),
    auditStatement(database, identity.email, "swimmer_updated", "swimmer", id, now),
  ]);
  return swimmerById(database, id);
}

async function deleteSwimmer(
  request: Request,
  database: D1Database,
  identity: AdminIdentity,
): Promise<Response> {
  const id = pathSegment(request, 4);
  if (!isUuid(id)) return invalidId(request, "swimmer");
  if (!(await rowExists(database, "swimmers", id))) return notFound(request, "Swimmer");
  const vote = await database
    .prepare("SELECT 1 AS present FROM votes WHERE voter_id = ?1 OR candidate_id = ?1 LIMIT 1")
    .bind(id)
    .first();
  if (vote !== null) {
    return apiError(request, 409, "conflict", "A swimmer referenced by a vote cannot be removed.");
  }

  const now = new Date().toISOString();
  const results = await database.batch([
    auditStatement(database, identity.email, "swimmer_deleted", "swimmer", id, now),
    database.prepare(
      `DELETE FROM swimmers
      WHERE id = ?1 AND NOT EXISTS (
        SELECT 1 FROM votes WHERE voter_id = ?1 OR candidate_id = ?1
      )`,
    ).bind(id),
  ]);
  if (results[1]?.meta.changes !== 1) {
    return apiError(request, 409, "conflict", "The swimmer could not be deleted safely.");
  }
  return noContent();
}

async function familyInput(request: Request): Promise<
  { ok: true; value: FamilyInput } | { ok: false; response: Response }
> {
  const json = await readBoundedJson(request);
  if (!json.ok) return json;
  if (typeof json.value !== "object" || json.value === null || Array.isArray(json.value)) {
    return invalidBody(request, "email must be a valid email address.");
  }
  const raw = Reflect.get(json.value, "email");
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return invalidBody(request, "email must be a valid email address.");
  }
  return { ok: true, value: { email } };
}

async function swimmerInput(request: Request): Promise<
  { ok: true; value: SwimmerInput } | { ok: false; response: Response }
> {
  const json = await readBoundedJson(request);
  if (!json.ok) return json;
  if (typeof json.value !== "object" || json.value === null || Array.isArray(json.value)) {
    return invalidBody(request, "name and group_name are invalid.");
  }
  const rawName = Reflect.get(json.value, "name");
  const rawGroup = Reflect.get(json.value, "group_name");
  const name = typeof rawName === "string" ? rawName.trim() : "";
  const groupName = rawGroup === null || rawGroup === undefined
    ? null
    : typeof rawGroup === "string"
      ? rawGroup.trim() || null
      : undefined;
  if (name.length === 0 || name.length > 120 || groupName === undefined || (groupName?.length ?? 0) > 80) {
    return invalidBody(request, "name must be 1-120 characters and group_name at most 80 characters.");
  }
  return { ok: true, value: { name, groupName } };
}

async function familyById(database: D1Database, id: string): Promise<Response> {
  const row = await database
    .prepare("SELECT id, email, family_token, created_at FROM families WHERE id = ?1")
    .bind(id)
    .first<{ id: string; email: string; family_token: string; created_at: string }>();
  if (row === null) throw new Error("Updated family disappeared.");
  return jsonResponse({ ...row, swimmers: [] });
}

async function swimmerById(database: D1Database, id: string): Promise<Response> {
  const row = await database
    .prepare(
      `SELECT id, name, group_name, created_at,
      EXISTS (SELECT 1 FROM votes WHERE voter_id = swimmers.id) AS has_voted
      FROM swimmers WHERE id = ?1`,
    )
    .bind(id)
    .first<{ id: string; name: string; group_name: string | null; created_at: string; has_voted: number }>();
  if (row === null) throw new Error("Updated swimmer disappeared.");
  return jsonResponse({ ...row, has_voted: row.has_voted === 1 });
}

function auditStatement(
  database: D1Database,
  actor: string,
  event: string,
  targetType: "family" | "swimmer",
  targetId: string,
  now: string,
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO admin_audit_events (
        id, actor_email, event_type, target_type, target_id, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(crypto.randomUUID(), actor, event, targetType, targetId, now);
}

async function rowExists(database: D1Database, table: "families" | "swimmers", id: string): Promise<boolean> {
  const row = await database.prepare(`SELECT 1 AS present FROM ${table} WHERE id = ?1 LIMIT 1`).bind(id).first();
  return row !== null;
}

function invalidBody(request: Request, message: string) {
  return { ok: false as const, response: apiError(request, 400, "invalid_request", message) };
}

function invalidId(request: Request, kind: string): Response {
  return apiError(request, 400, "invalid_request", `The ${kind} ID is invalid.`);
}

function notFound(request: Request, kind: string): Response {
  return apiError(request, 404, "not_found", `${kind} not found.`);
}

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
