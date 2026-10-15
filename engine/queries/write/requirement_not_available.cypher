// A "not available" answer: the requirements about that field become not_available. Never "no":
// the value stays empty and the gap stays visible. Params: $pid, $fact_id, $fields
MATCH (p:Patient {id: $pid})-[:HAS]->(fact {id: $fact_id})<-[:ABOUT]-(r:EvidenceRequirement)
WHERE r.field IN $fields
SET r.state = 'not_available'
RETURN r.id AS requirement_id
