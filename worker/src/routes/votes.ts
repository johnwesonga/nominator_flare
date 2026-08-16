import { isUuid, pathSegment, readBoundedJson } from "../request";
import { apiError, jsonResponse } from "../responses";

type VoteRequest = {
  voter_swimmer_id: string;
  candidate_id: string;
};

type VoteDiagnosis = {
  voting_open: number;
  owns_voter: number;
  already_voted: number;
  candidate_valid: number;
};

export async function handleVoteRoute(
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

  const json = await readBoundedJson(request);
  if (!json.ok) return json.response;

  const body = parseVoteRequest(json.value);
  if (body === null) {
    return apiError(
      request,
      400,
      "invalid_request",
      "voter_swimmer_id and candidate_id must be UUID strings.",
    );
  }

  const session = env.DB.withSession("first-primary");
  const inserted = await session
    .prepare(
      `INSERT INTO votes (id, voter_id, candidate_id, created_at)
      SELECT ?1, voter.id, candidate.id, ?2
      FROM swimmers voter
      JOIN families family ON family.id = voter.family_id
      JOIN voting_settings settings ON settings.id = 1
      JOIN swimmers candidate ON candidate.id = ?3
      WHERE family.family_token = ?4
        AND voter.id = ?5
        AND settings.is_open = 1
      ON CONFLICT(voter_id) DO NOTHING
      RETURNING id`,
    )
    .bind(
      crypto.randomUUID(),
      new Date().toISOString(),
      body.candidate_id,
      familyToken,
      body.voter_swimmer_id,
    )
    .first<{ id: string }>();

  if (inserted !== null) return jsonResponse("ok");

  const diagnosis = await session
    .prepare(
      `SELECT
        COALESCE((SELECT is_open FROM voting_settings WHERE id = 1), 0)
          AS voting_open,
        EXISTS (
          SELECT 1
          FROM swimmers voter
          JOIN families family ON family.id = voter.family_id
          WHERE voter.id = ?1 AND family.family_token = ?2
        ) AS owns_voter,
        EXISTS (SELECT 1 FROM votes WHERE voter_id = ?1) AS already_voted,
        EXISTS (SELECT 1 FROM swimmers WHERE id = ?3) AS candidate_valid`,
    )
    .bind(body.voter_swimmer_id, familyToken, body.candidate_id)
    .first<VoteDiagnosis>();

  if (diagnosis === null || diagnosis.voting_open !== 1) {
    return jsonResponse("voting_closed");
  }
  if (diagnosis.owns_voter !== 1) return jsonResponse("not_your_child");
  if (diagnosis.already_voted === 1) return jsonResponse("already_voted");
  if (diagnosis.candidate_valid !== 1) {
    return jsonResponse("invalid_candidate");
  }

  throw new Error("Vote insert failed without a diagnosable business result.");
}

function parseVoteRequest(value: unknown): VoteRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const voter = Reflect.get(value, "voter_swimmer_id");
  const candidate = Reflect.get(value, "candidate_id");
  if (!isUuid(voter) || !isUuid(candidate)) return null;

  return { voter_swimmer_id: voter, candidate_id: candidate };
}
