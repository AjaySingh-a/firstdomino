// FindingRevision n=1 (first evaluation). Params: $pid, $fid, $rev_id, $status, $reason, $created_at, $eval_version
MATCH (p:Patient {id: $pid})-[:HAS]->(f:Finding {id: $fid})
MERGE (rev:FindingRevision {id: $rev_id})
ON CREATE SET rev.patient_id = $pid, rev.finding_id = $fid, rev.n = 1, rev.status = $status,
              rev.reason = $reason, rev.changed_fact_ids = [], rev.created_at = $created_at,
              rev.eval_version = $eval_version
MERGE (rev)-[:OF]->(f)
