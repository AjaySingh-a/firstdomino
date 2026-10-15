// One review-agent step (an audit record). Checks case_version but does not move it: a step changes
// no fact, finding or review. MERGE on the step id, so re-sending it writes nothing.
// No row back = stale case_version.
// Params: $pid, $case_version, $id, $props, $fid (finding id or null)
MATCH (p:Patient {id: $pid})
WHERE p.case_version = $case_version
OPTIONAL MATCH (p)-[:HAS]->(steps:AgentStep)
WITH p, count(steps) AS n
MERGE (s:AgentStep {id: $id})
ON CREATE SET s += $props, s.seq = n + 1
MERGE (p)-[:HAS]->(s)
WITH p, s
OPTIONAL MATCH (p)-[:HAS]->(f:Finding {id: $fid})
FOREACH (x IN CASE WHEN f IS NULL THEN [] ELSE [f] END | MERGE (s)-[:FOR]->(x))
RETURN s
