-- Read-only post-import checks. All violation metrics must be zero.
SELECT 'families' AS metric, COUNT(*) AS value FROM families
UNION ALL SELECT 'swimmers', COUNT(*) FROM swimmers
UNION ALL SELECT 'votes', COUNT(*) FROM votes
UNION ALL SELECT 'admins', COUNT(*) FROM admins
UNION ALL SELECT 'family_tokens_distinct', COUNT(DISTINCT family_token) FROM families
UNION ALL SELECT 'derived_voters', COUNT(*) FROM swimmers s WHERE EXISTS (SELECT 1 FROM votes v WHERE v.voter_id = s.id)
UNION ALL SELECT 'result_votes', COALESCE(SUM(vote_count), 0) FROM vote_results
UNION ALL SELECT 'orphan_swimmers', COUNT(*) FROM swimmers s LEFT JOIN families f ON f.id = s.family_id WHERE f.id IS NULL
UNION ALL SELECT 'orphan_voters', COUNT(*) FROM votes v LEFT JOIN swimmers s ON s.id = v.voter_id WHERE s.id IS NULL
UNION ALL SELECT 'orphan_candidates', COUNT(*) FROM votes v LEFT JOIN swimmers s ON s.id = v.candidate_id WHERE s.id IS NULL
UNION ALL SELECT 'duplicate_voters', COUNT(*) FROM (SELECT voter_id FROM votes GROUP BY voter_id HAVING COUNT(*) > 1)
UNION ALL SELECT 'voting_settings_rows', COUNT(*) FROM voting_settings;

PRAGMA foreign_key_check;
