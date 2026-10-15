// One EvidenceRequirement per gap. Params: $pid, $fid, $rid, $kind, $field, $state, $about
MATCH (p:Patient {id: $pid})-[:HAS]->(f:Finding {id: $fid})
MATCH (p)-[:HAS]->(t {id: $about})
MERGE (r:EvidenceRequirement {id: $rid})
ON CREATE SET r.patient_id = $pid, r.finding_id = $fid, r.kind = $kind, r.field = $field, r.state = $state
MERGE (f)-[:NEEDS]->(r)
MERGE (r)-[:ABOUT]->(t)
