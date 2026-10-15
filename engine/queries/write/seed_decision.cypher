// Seed: a review decision that is already part of the story (story 3). ON CREATE only.
// Params: $pid, $fid, $id, $revision_n, $by_role, $decision, $reason, $decided_at
MATCH (p:Patient {id: $pid})-[:HAS]->(f:Finding {id: $fid})<-[:OF]-(rev:FindingRevision {n: $revision_n})
MERGE (d:ReviewDecision {id: $id})
ON CREATE SET d.patient_id = $pid, d.finding_id = $fid, d.revision_n = $revision_n, d.by_role = $by_role,
              d.decision = $decision, d.reason = $reason, d.decided_at = $decided_at,
              f.status = CASE WHEN f.revision_n = $revision_n THEN 'reviewed' ELSE f.status END
MERGE (d)-[:ON]->(rev)
