// Q5 · review history: every revision of a finding, human decisions kept intact.
// Params: $pid, $fid
MATCH (p:Patient {id: $pid})
MATCH (f:Finding {id: $fid, patient_id: $pid})<-[:OF]-(rev:FindingRevision)
OPTIONAL MATCH (d:ReviewDecision)-[:ON]->(rev)
RETURN rev.n AS n, rev.reason AS reason, rev.changed_fact_ids AS changed_fact_ids,
       d.decision AS decision, d.by_role AS by_role, d.reason AS decision_reason,
       d.decided_at AS decided_at
ORDER BY n
