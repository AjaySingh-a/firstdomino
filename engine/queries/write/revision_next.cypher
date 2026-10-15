// FindingRevision n+1 after an evidence change: linked to n by PREVIOUS and to the event by BECAUSE.
// Decisions stay ON the revision they were made on. Updates the finding's current status.
// Params: $pid, $fid, $prev_n, $rev_id, $n, $status, $reason, $changed_fact_ids, $created_at,
//         $eval_version, $headline, $event_id
MATCH (p:Patient {id: $pid})-[:HAS]->(f:Finding {id: $fid})<-[:OF]-(prev:FindingRevision {n: $prev_n})
WHERE f.revision_n = $prev_n
MATCH (p)-[:HAS]->(e:EvidenceEvent {id: $event_id})
MERGE (rev:FindingRevision {id: $rev_id})
ON CREATE SET rev.patient_id = $pid, rev.finding_id = $fid, rev.n = $n, rev.status = $status,
              rev.reason = $reason, rev.changed_fact_ids = $changed_fact_ids, rev.created_at = $created_at,
              rev.eval_version = $eval_version
MERGE (rev)-[:OF]->(f)
MERGE (rev)-[:PREVIOUS]->(prev)
MERGE (rev)-[:BECAUSE]->(e)
SET f.status = $status, f.revision_n = $n, f.headline = $headline, f.eval_version = $eval_version
RETURN rev
