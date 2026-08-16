import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { routeRequest } from "../src/router";

const FAMILY_1 = "00000000-0000-4000-8000-000000000001";
const FAMILY_2 = "00000000-0000-4000-8000-000000000002";
const FAMILY_EMPTY = "00000000-0000-4000-8000-000000000003";
const TOKEN_1 = "10000000-0000-4000-8000-000000000001";
const TOKEN_2 = "10000000-0000-4000-8000-000000000002";
const TOKEN_EMPTY = "10000000-0000-4000-8000-000000000003";
const UNKNOWN_TOKEN = "10000000-0000-4000-8000-000000000099";
const SWIMMER_1 = "20000000-0000-4000-8000-000000000001";
const SWIMMER_2 = "20000000-0000-4000-8000-000000000002";
const SWIMMER_3 = "20000000-0000-4000-8000-000000000003";
const UNKNOWN_SWIMMER = "20000000-0000-4000-8000-000000000099";
const CREATED_AT = "2026-08-14T00:00:00.000Z";

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.batch([
    env.DB
      .prepare(
        "INSERT INTO families (id, email, family_token, created_at) VALUES (?1, ?2, ?3, ?4)",
      )
      .bind(FAMILY_1, "one@example.com", TOKEN_1, CREATED_AT),
    env.DB
      .prepare(
        "INSERT INTO families (id, email, family_token, created_at) VALUES (?1, ?2, ?3, ?4)",
      )
      .bind(FAMILY_2, "two@example.com", TOKEN_2, CREATED_AT),
    env.DB
      .prepare(
        "INSERT INTO families (id, email, family_token, created_at) VALUES (?1, ?2, ?3, ?4)",
      )
      .bind(FAMILY_EMPTY, "empty@example.com", TOKEN_EMPTY, CREATED_AT),
    env.DB
      .prepare(
        "INSERT INTO swimmers (id, family_id, name, group_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .bind(SWIMMER_1, FAMILY_1, "Zulu Swimmer", "Sharks", CREATED_AT),
    env.DB
      .prepare(
        "INSERT INTO swimmers (id, family_id, name, group_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .bind(SWIMMER_2, FAMILY_1, "alpha Swimmer", null, CREATED_AT),
    env.DB
      .prepare(
        "INSERT INTO swimmers (id, family_id, name, group_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .bind(SWIMMER_3, FAMILY_2, "Beta Swimmer", "Dolphins", CREATED_AT),
  ]);
});

afterEach(async () => {
  await reset();
});

function get(path: string): Promise<Response> {
  return routeRequest(new Request(`https://example.test${path}`), env);
}

function vote(
  token: string,
  voter_swimmer_id: string,
  candidate_id: string,
): Promise<Response> {
  return routeRequest(
    new Request(`https://example.test/api/ballots/${token}/votes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voter_swimmer_id, candidate_id }),
    }),
    env,
  );
}

describe("public ballot API", () => {
  it("returns a family ballot and derives vote state", async () => {
    expect(await json(await get(`/api/ballots/${TOKEN_1}`))).toEqual([
      {
        swimmer_id: SWIMMER_2,
        swimmer_name: "alpha Swimmer",
        has_voted: false,
        voting_open: true,
        voted_for_name: null,
      },
      {
        swimmer_id: SWIMMER_1,
        swimmer_name: "Zulu Swimmer",
        has_voted: false,
        voting_open: true,
        voted_for_name: null,
      },
    ]);

    expect(await json(await vote(TOKEN_1, SWIMMER_1, SWIMMER_3))).toBe("ok");
    const ballot = await json(await get(`/api/ballots/${TOKEN_1}`));
    expect(ballot).toContainEqual({
      swimmer_id: SWIMMER_1,
      swimmer_name: "Zulu Swimmer",
      has_voted: true,
      voting_open: true,
      voted_for_name: "Beta Swimmer",
    });
  });

  it("returns an empty ballot for an unknown token", async () => {
    const response = await get(`/api/ballots/${UNKNOWN_TOKEN}`);
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual([]);
  });

  it("returns a sorted candidate roster only for a valid token", async () => {
    const response = await get(`/api/ballots/${TOKEN_EMPTY}/candidates`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await json(response)).toEqual([
      { id: SWIMMER_2, name: "alpha Swimmer" },
      { id: SWIMMER_3, name: "Beta Swimmer" },
      { id: SWIMMER_1, name: "Zulu Swimmer" },
    ]);

    const missing = await get(`/api/ballots/${UNKNOWN_TOKEN}/candidates`);
    expect(missing.status).toBe(404);
  });

  it("rejects malformed tokens", async () => {
    const response = await get("/api/ballots/not-a-uuid");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_request" },
    });
  });
});

describe("public vote API", () => {
  it("completes the ballot lifecycle and enforces an immediate close", async () => {
    expect(await json(await vote(TOKEN_1, SWIMMER_1, SWIMMER_3))).toBe("ok");
    expect(await json(await vote(TOKEN_1, SWIMMER_2, SWIMMER_1))).toBe("ok");

    const reloaded = await json(await get(`/api/ballots/${TOKEN_1}`));
    expect(reloaded).toEqual([
      {
        swimmer_id: SWIMMER_2,
        swimmer_name: "alpha Swimmer",
        has_voted: true,
        voting_open: true,
        voted_for_name: "Zulu Swimmer",
      },
      {
        swimmer_id: SWIMMER_1,
        swimmer_name: "Zulu Swimmer",
        has_voted: true,
        voting_open: true,
        voted_for_name: "Beta Swimmer",
      },
    ]);

    expect(await json(await vote(TOKEN_1, SWIMMER_1, SWIMMER_2))).toBe(
      "already_voted",
    );
    await env.DB.prepare("UPDATE voting_settings SET is_open = 0 WHERE id = 1").run();
    expect(await json(await vote(TOKEN_2, SWIMMER_3, SWIMMER_1))).toBe(
      "voting_closed",
    );

    const results = await env.DB
      .prepare(
        "SELECT candidate_id, vote_count FROM vote_results WHERE vote_count > 0 ORDER BY candidate_id",
      )
      .all<{ candidate_id: string; vote_count: number }>();
    expect(results.results).toEqual([
      { candidate_id: SWIMMER_1, vote_count: 1 },
      { candidate_id: SWIMMER_3, vote_count: 1 },
    ]);
  });

  it("returns ok and writes exactly one vote", async () => {
    const response = await vote(TOKEN_1, SWIMMER_1, SWIMMER_3);
    expect(response.status).toBe(200);
    expect(await json(response)).toBe("ok");
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM votes").first<number>(
        "count",
      ),
    ).toBe(1);
  });

  it("returns every frozen business result", async () => {
    expect(await json(await vote(TOKEN_1, SWIMMER_1, SWIMMER_3))).toBe("ok");
    expect(await json(await vote(TOKEN_1, SWIMMER_1, SWIMMER_2))).toBe(
      "already_voted",
    );
    expect(await json(await vote(TOKEN_1, SWIMMER_3, SWIMMER_2))).toBe(
      "not_your_child",
    );
    expect(await json(await vote(TOKEN_1, SWIMMER_2, UNKNOWN_SWIMMER))).toBe(
      "invalid_candidate",
    );

    await env.DB.prepare("UPDATE voting_settings SET is_open = 0 WHERE id = 1").run();
    expect(await json(await vote(TOKEN_1, SWIMMER_2, SWIMMER_3))).toBe(
      "voting_closed",
    );
  });

  it("allows a swimmer to nominate themself", async () => {
    expect(await json(await vote(TOKEN_1, SWIMMER_1, SWIMMER_1))).toBe("ok");
  });

  it("allows only one of two simultaneous votes for a voter", async () => {
    const responses = await Promise.all([
      vote(TOKEN_1, SWIMMER_2, SWIMMER_1),
      vote(TOKEN_1, SWIMMER_2, SWIMMER_3),
    ]);
    const outcomes = await Promise.all(responses.map(json));
    expect(outcomes.sort()).toEqual(["already_voted", "ok"]);
    expect(
      await env.DB
        .prepare("SELECT COUNT(*) AS count FROM votes WHERE voter_id = ?1")
        .bind(SWIMMER_2)
        .first<number>("count"),
    ).toBe(1);
  });

  it("rejects malformed and oversized request bodies", async () => {
    const malformed = await routeRequest(
      new Request(`https://example.test/api/ballots/${TOKEN_1}/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
      env,
    );
    expect(malformed.status).toBe(400);

    const oversized = await routeRequest(
      new Request(`https://example.test/api/ballots/${TOKEN_1}/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ padding: "x".repeat(5000) }),
      }),
      env,
    );
    expect(oversized.status).toBe(400);
  });
});

async function json(response: Response): Promise<unknown> {
  return response.json();
}
