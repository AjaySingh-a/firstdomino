// Q10 · the review agent's steps for one patient, oldest first, with the finding each was for.
// Params: $pid
MATCH (p:Patient {id: $pid})-[:HAS]->(s:AgentStep)
OPTIONAL MATCH (s)-[:FOR]->(f:Finding)<-[:HAS]-(p)
RETURN s, f.id AS finding_id
ORDER BY s.at, s.seq, s.id
