// Q5 · full history of a finding: every revision, the revision it follows (PREVIOUS), the human
// decisions kept on the revision they were made on, and the evidence events behind each revision.
// Params: $pid, $fid
MATCH (p:Patient {id: $pid})-[:HAS]->(f:Finding {id: $fid})<-[:OF]-(rev:FindingRevision)
OPTIONAL MATCH (rev)-[:PREVIOUS]->(prev:FindingRevision)
OPTIONAL MATCH (d:ReviewDecision)-[:ON]->(rev)
OPTIONAL MATCH (rev)-[:BECAUSE]->(e:EvidenceEvent)
RETURN rev, prev.n AS previous_n, collect(DISTINCT d) AS decisions, collect(DISTINCT e.id) AS event_ids
ORDER BY rev.n
