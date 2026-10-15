// Q3 · affected findings: only the findings that cite, link (FROM/TO) or need the changed fact.
// Only these re-run the rules after an evidence change; every other finding is left alone.
// Params: $pid, $fact_id
// FalkorDB 4.22: [:A|B|C] and UNION (which also de-duplicates) work.
MATCH (p:Patient {id: $pid})-[:HAS]->(fact {id: $fact_id})
MATCH (p)-[:HAS]->(f:Finding)-[:CITES|FROM|TO]->(fact)
RETURN f.id AS finding
UNION
MATCH (p:Patient {id: $pid})-[:HAS]->(fact {id: $fact_id})
MATCH (p)-[:HAS]->(f:Finding)-[:NEEDS]->(:EvidenceRequirement)-[:ABOUT]->(fact)
RETURN f.id AS finding
