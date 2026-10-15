// Q5 · review history: every revision of a finding, human decisions kept intact.
// Params: $pid, $fid
MATCH (p:Patient {id: $pid})-[:HAS]->(f:Finding {id: $fid})<-[:OF]-(rev:FindingRevision)
OPTIONAL MATCH (rev)-[:PREVIOUS]->(prev:FindingRevision)
OPTIONAL MATCH (d:ReviewDecision)-[:ON]->(rev)
RETURN rev, prev.n AS previous_n, collect(d) AS decisions
ORDER BY rev.n
