// Q3 · dependency scope: the findings that touch the fact that just changed. Only these re-evaluate.
// Params: $pid, $fact_id
// TODO(Dev, Day 1): check the multi-type relationship [:CITES|FROM|TO] and UNION on FalkorDB.
MATCH (p:Patient {id: $pid})-[:HAS]->(fact {id: $fact_id})
MATCH (f:Finding {patient_id: $pid})-[:CITES|FROM|TO]->(fact)
RETURN f.id AS finding
UNION
MATCH (p:Patient {id: $pid})-[:HAS]->(fact {id: $fact_id})
MATCH (f:Finding {patient_id: $pid})-[:NEEDS]->(:EvidenceRequirement)-[:ABOUT]->(fact)
RETURN f.id AS finding
