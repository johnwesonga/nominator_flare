import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
} from "jose";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { routeRequest } from "../src/router";

const MANAGER_EMAIL = "manager@example.com";
const FAMILY_ID = "00000000-0000-4000-8000-000000000001";
const FAMILY_TOKEN = "10000000-0000-4000-8000-000000000001";
const SWIMMER_1 = "20000000-0000-4000-8000-000000000001";
const SWIMMER_2 = "20000000-0000-4000-8000-000000000002";
const CREATED_AT = "2026-08-14T00:00:00.000Z";

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const keyPair = await generateKeyPair("RS256");
  privateKey = keyPair.privateKey;
  publicJwk = await exportJWK(keyPair.publicKey);
  publicJwk.kid = "access-test-key";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  otherPrivateKey = (await generateKeyPair("RS256")).privateKey;
});

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
        "INSERT INTO swimmers (id, family_id, name, group_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .bind(SWIMMER_1, FAMILY_ID, "Alpha Swimmer", "Sharks", CREATED_AT),
    env.DB
      .prepare(
        "INSERT INTO swimmers (id, family_id, name, group_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .bind(SWIMMER_2, FAMILY_ID, "Beta Swimmer", null, CREATED_AT),
    env.DB
      .prepare(
        "INSERT INTO votes (id, voter_id, candidate_id, created_at) VALUES (?1, ?2, ?3, ?4)",
      )
      .bind(
        "30000000-0000-4000-8000-000000000001",
        SWIMMER_1,
        SWIMMER_2,
        CREATED_AT,
      ),
  ]);

  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json({ keys: [publicJwk] }),
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

afterAll(() => {
  vi.restoreAllMocks();
});

async function accessToken(
  options: {
    audience?: string;
    email?: string;
    expiration?: string;
    key?: CryptoKey;
  } = {},
): Promise<string> {
  return new SignJWT(
    options.email === undefined ? { email: MANAGER_EMAIL } : { email: options.email },
  )
    .setProtectedHeader({ alg: "RS256", kid: "access-test-key" })
    .setIssuer(env.ACCESS_TEAM_DOMAIN)
    .setAudience(options.audience ?? env.ACCESS_AUD)
    .setSubject("access-user-id")
    .setIssuedAt()
    .setExpirationTime(options.expiration ?? "5m")
    .sign(options.key ?? privateKey);
}

async function adminRequest(
  path: string,
  options: { body?: unknown; method?: string; token?: string } = {},
): Promise<Response> {
  const headers = new Headers();
  if (options.token !== undefined) {
    headers.set("Cf-Access-Jwt-Assertion", options.token);
  }
  if (options.body !== undefined) headers.set("Content-Type", "application/json");

  const init: RequestInit = { method: options.method ?? "GET", headers };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  return routeRequest(new Request(`https://example.test${path}`, init), env);
}

describe("Cloudflare Access authorization", () => {
  it("rejects a missing assertion", async () => {
    const response = await adminRequest("/api/admin/session");
    expect(response.status).toBe(401);
  });

  it.each<[string, () => Promise<string>]>([
    ["wrong audience", () => accessToken({ audience: "wrong-audience" })],
    ["expired", () => accessToken({ expiration: "0s" })],
    ["wrong signature", () => accessToken({ key: otherPrivateKey })],
  ])("rejects a token with %s", async (_name, makeToken) => {
    const response = await adminRequest("/api/admin/session", {
      token: await makeToken(),
    });
    expect(response.status).toBe(401);
  });

  it("rejects an Access identity without an email claim", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "access-test-key" })
      .setIssuer(env.ACCESS_TEAM_DOMAIN)
      .setAudience(env.ACCESS_AUD)
      .setExpirationTime("5m")
      .sign(privateKey);
    const response = await adminRequest("/api/admin/session", { token });
    expect(response.status).toBe(401);
  });

  it("rejects a valid identity missing from the D1 allowlist", async () => {
    const response = await adminRequest("/api/admin/session", {
      token: await accessToken({ email: "other@example.com" }),
    });
    expect(response.status).toBe(403);
  });

  it("normalizes an allowlisted email and returns the session", async () => {
    const response = await adminRequest("/api/admin/session", {
      token: await accessToken({ email: " MANAGER@EXAMPLE.COM " }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ email: MANAGER_EMAIL });
  });
});

describe("admin API", () => {
  it("lists families including their derived swimmer state", async () => {
    const response = await adminRequest("/api/admin/families", {
      token: await accessToken(),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        id: FAMILY_ID,
        email: "parent@example.com",
        family_token: FAMILY_TOKEN,
        created_at: CREATED_AT,
        swimmers: [
          {
            id: SWIMMER_1,
            name: "Alpha Swimmer",
            group_name: "Sharks",
            created_at: CREATED_AT,
            has_voted: true,
          },
          {
            id: SWIMMER_2,
            name: "Beta Swimmer",
            group_name: null,
            created_at: CREATED_AT,
            has_voted: false,
          },
        ],
      },
    ]);
  });

  it("creates and updates a normalized family with an audit trail", async () => {
    const token = await accessToken();
    const created = await adminRequest("/api/admin/families", {
      body: { email: " NEW.PARENT@Example.COM " },
      method: "POST",
      token,
    });
    expect(created.status).toBe(201);
    const family = await created.json<{
      id: string;
      email: string;
      family_token: string;
      swimmers: unknown[];
    }>();
    expect(family.email).toBe("new.parent@example.com");
    expect(family.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(family.family_token).toMatch(/^[0-9a-f-]{36}$/);
    expect(family.swimmers).toEqual([]);

    const updated = await adminRequest(`/api/admin/families/${family.id}`, {
      body: { email: "updated.parent@example.com" },
      method: "PUT",
      token,
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      id: family.id,
      email: "updated.parent@example.com",
    });

    const events = await env.DB
      .prepare(
        `SELECT actor_email, event_type FROM admin_audit_events
        WHERE event_type LIKE 'family_%' ORDER BY created_at, event_type`,
      )
      .all<{ actor_email: string; event_type: string }>();
    expect(events.results).toEqual([
      { actor_email: MANAGER_EMAIL, event_type: "family_created" },
      { actor_email: MANAGER_EMAIL, event_type: "family_updated" },
    ]);
  });

  it("rejects duplicate and invalid family emails", async () => {
    const token = await accessToken();
    const duplicate = await adminRequest("/api/admin/families", {
      body: { email: "PARENT@example.com" },
      method: "POST",
      token,
    });
    expect(duplicate.status).toBe(409);

    const invalid = await adminRequest("/api/admin/families", {
      body: { email: "not-an-email" },
      method: "POST",
      token,
    });
    expect(invalid.status).toBe(400);
  });

  it("adds and updates a swimmer with normalized optional group data", async () => {
    const token = await accessToken();
    const created = await adminRequest(`/api/admin/families/${FAMILY_ID}/swimmers`, {
      body: { name: "  Gamma Swimmer ", group_name: "  Dolphins " },
      method: "POST",
      token,
    });
    expect(created.status).toBe(201);
    const swimmer = await created.json<{ id: string }>();
    await expect(
      env.DB.prepare("SELECT name, group_name FROM swimmers WHERE id = ?1").bind(swimmer.id).first(),
    ).resolves.toEqual({ name: "Gamma Swimmer", group_name: "Dolphins" });

    const updated = await adminRequest(`/api/admin/swimmers/${swimmer.id}`, {
      body: { name: "Gamma Updated", group_name: "" },
      method: "PUT",
      token,
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      name: "Gamma Updated",
      group_name: null,
      has_voted: false,
    });
  });

  it("enforces safe swimmer and family deletion rules", async () => {
    const token = await accessToken();
    const familyBlocked = await adminRequest(`/api/admin/families/${FAMILY_ID}`, {
      method: "DELETE",
      token,
    });
    expect(familyBlocked.status).toBe(409);

    const swimmerBlocked = await adminRequest(`/api/admin/swimmers/${SWIMMER_2}`, {
      method: "DELETE",
      token,
    });
    expect(swimmerBlocked.status).toBe(409);

    const familyResponse = await adminRequest("/api/admin/families", {
      body: { email: "deletable@example.com" },
      method: "POST",
      token,
    });
    const family = await familyResponse.json<{ id: string }>();
    const swimmerResponse = await adminRequest(`/api/admin/families/${family.id}/swimmers`, {
      body: { name: "Deletable Swimmer", group_name: null },
      method: "POST",
      token,
    });
    const swimmer = await swimmerResponse.json<{ id: string }>();

    const swimmerDeleted = await adminRequest(`/api/admin/swimmers/${swimmer.id}`, {
      method: "DELETE",
      token,
    });
    expect(swimmerDeleted.status).toBe(204);
    const familyDeleted = await adminRequest(`/api/admin/families/${family.id}`, {
      method: "DELETE",
      token,
    });
    expect(familyDeleted.status).toBe(204);

    const rows = await env.DB
      .prepare("SELECT event_type FROM admin_audit_events WHERE event_type LIKE '%_deleted' ORDER BY event_type")
      .all<{ event_type: string }>();
    expect(rows.results).toEqual([
      { event_type: "family_deleted" },
      { event_type: "swimmer_deleted" },
    ]);
  });

  it("returns the derived admin roster", async () => {
    const response = await adminRequest("/api/admin/roster", {
      token: await accessToken(),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        family_id: FAMILY_ID,
        family_email: "parent@example.com",
        family_token: FAMILY_TOKEN,
        swimmer_id: SWIMMER_2,
        swimmer_name: "Beta Swimmer",
        group_name: null,
        has_voted: false,
      },
      {
        family_id: FAMILY_ID,
        family_email: "parent@example.com",
        family_token: FAMILY_TOKEN,
        swimmer_id: SWIMMER_1,
        swimmer_name: "Alpha Swimmer",
        group_name: "Sharks",
        has_voted: true,
      },
    ]);
  });

  it("returns results including candidates with zero votes", async () => {
    const response = await adminRequest("/api/admin/results", {
      token: await accessToken(),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { candidate_id: SWIMMER_2, candidate_name: "Beta Swimmer", vote_count: 1 },
      { candidate_id: SWIMMER_1, candidate_name: "Alpha Swimmer", vote_count: 0 },
    ]);
  });

  it("closes and reopens voting idempotently with an audit identity", async () => {
    const token = await accessToken();
    const closed = await adminRequest("/api/admin/voting", {
      body: { open: false },
      method: "PUT",
      token,
    });
    expect(closed.status).toBe(204);

    const closedState = await env.DB
      .prepare(
        "SELECT is_open, closed_at, updated_by FROM voting_settings WHERE id = 1",
      )
      .first<{ is_open: number; closed_at: string | null; updated_by: string | null }>();
    expect(closedState?.is_open).toBe(0);
    expect(closedState?.closed_at).not.toBeNull();
    expect(closedState?.updated_by).toBe(MANAGER_EMAIL);

    const opened = await adminRequest("/api/admin/voting", {
      body: { open: true },
      method: "PUT",
      token,
    });
    expect(opened.status).toBe(204);
    const openedState = await env.DB
      .prepare("SELECT is_open, closed_at FROM voting_settings WHERE id = 1")
      .first<{ is_open: number; closed_at: string | null }>();
    expect(openedState).toEqual({ is_open: 1, closed_at: null });

    const auditEvents = await env.DB
      .prepare(
        "SELECT actor_email, event_type FROM admin_audit_events ORDER BY created_at, event_type",
      )
      .all<{ actor_email: string; event_type: string }>();
    expect(auditEvents.results).toEqual([
      { actor_email: MANAGER_EMAIL, event_type: "voting_closed" },
      { actor_email: MANAGER_EMAIL, event_type: "voting_opened" },
    ]);
  });

  it("rejects an invalid voting body", async () => {
    const response = await adminRequest("/api/admin/voting", {
      body: { open: "yes" },
      method: "PUT",
      token: await accessToken(),
    });
    expect(response.status).toBe(400);
  });

  it("protects notification campaigns before accepting one", async () => {
    const missing = await adminRequest("/api/admin/notifications", {
      method: "POST",
    });
    expect(missing.status).toBe(401);

    const authorized = await adminRequest("/api/admin/notifications", {
      method: "POST",
      token: await accessToken(),
    });
    expect(authorized.status).toBe(202);
  });
});
