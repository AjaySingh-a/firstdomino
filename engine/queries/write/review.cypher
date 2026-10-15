// ReviewDecision on the finding's current revision, in ONE query: compare-and-set on case_version
// and revision_n. No row back = stale (the API answers 409) and nothing was written.
// Params: $pid, $fid, $case_version, $revision_n, $by_role, $decision, $reason, $decided_at
MATCH (p:Patient {id: $pid})-[:HAS]->(f:Finding {id: $fid})<-[:OF]-(rev:FindingRevision {n: $revision_n})
WHERE p.case_version = $case_version AND f.revision_n = $revision_n
OPTIONAL MATCH (d:ReviewDecision)-[:ON]->(rev)
WITH p, f, rev, count(d) AS k
CREATE (dec:ReviewDecision {
  id: $fid + ':rev-' + toString($revision_n) + ':dec-' + toString(k + 1),
  patient_id: $pid, finding_id: $fid, revision_n: $revision_n, by_role: $by_role,
  decision: $decision, reason: $reason, decided_at: $decided_at
})
CREATE (dec)-[:ON]->(rev)
SET f.status = 'reviewed', p.case_version = $case_version + 1
RETURN dec, p.case_version AS case_version
