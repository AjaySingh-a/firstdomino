// Re-evaluation: one EvidenceRequirement per gap the rules still see. A not_available answer stays
// not_available while the gap is open: it is never read as "no" and never asked again.
// Params: $pid, $fid, $rid, $kind, $field, $state, $about
MATCH (p:Patient {id: $pid})-[:HAS]->(f:Finding {id: $fid})
MATCH (p)-[:HAS]->(t {id: $about})
MERGE (r:EvidenceRequirement {id: $rid})
ON CREATE SET r.patient_id = $pid, r.finding_id = $fid, r.kind = $kind, r.field = $field, r.state = $state
ON MATCH SET r.state = CASE WHEN r.state = 'not_available' AND $state = 'missing' THEN r.state ELSE $state END
MERGE (f)-[:NEEDS]->(r)
MERGE (r)-[:ABOUT]->(t)
