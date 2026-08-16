import { isUuid, pathSegment } from "../request";
import { apiError, jsonResponse } from "../responses";

type BallotDatabaseRow = {
  swimmer_id: string;
  swimmer_name: string;
  has_voted: number;
  voting_open: number;
  voted_for_name: string | null;
};

type CandidateRow = {
  id: string;
  name: string;
};

export async function handleBallotRoute(
  request: Request,
  env: Env,
): Promise<Response> {
  const familyToken = pathSegment(request, 3);
  if (!isUuid(familyToken)) {
    return apiError(
      request,
      400,
      "invalid_request",
      "The family token is invalid.",
    );
  }

  if (new URL(request.url).pathname.endsWith("/candidates")) {
    return candidates(request, env.DB, familyToken);
  }

  const result = await env.DB
    .prepare(
      `SELECT
        s.id AS swimmer_id,
        s.name AS swimmer_name,
        EXISTS (SELECT 1 FROM votes v WHERE v.voter_id = s.id) AS has_voted,
        vs.is_open AS voting_open,
        candidate.name AS voted_for_name
      FROM swimmers s
      JOIN families f ON f.id = s.family_id
      JOIN voting_settings vs ON vs.id = 1
      LEFT JOIN votes vote ON vote.voter_id = s.id
      LEFT JOIN swimmers candidate ON candidate.id = vote.candidate_id
      WHERE f.family_token = ?1
      ORDER BY s.name COLLATE NOCASE, s.id`,
    )
    .bind(familyToken)
    .all<BallotDatabaseRow>();

  return jsonResponse(
    result.results.map((row) => ({
      swimmer_id: row.swimmer_id,
      swimmer_name: row.swimmer_name,
      has_voted: row.has_voted === 1,
      voting_open: row.voting_open === 1,
      voted_for_name: row.voted_for_name,
    })),
  );
}

async function candidates(
  request: Request,
  database: D1Database,
  familyToken: string,
): Promise<Response> {
  const family = await database
    .prepare("SELECT 1 AS present FROM families WHERE family_token = ?1 LIMIT 1")
    .bind(familyToken)
    .first<{ present: number }>();

  if (family === null) {
    return apiError(request, 404, "not_found", "Ballot not found.");
  }

  const result = await database
    .prepare(
      `SELECT id, name
      FROM swimmers
      ORDER BY name COLLATE NOCASE, id`,
    )
    .all<CandidateRow>();

  return jsonResponse(result.results);
}
