// Q9 · the patient's evidence requirements, what each is about, and the question asked for it (if any).
// POST /questions checks the requirement here; the investigation shows an asked, unanswered question.
// Params: $pid
MATCH (p:Patient {id: $pid})-[:HAS]->(f:Finding)-[:NEEDS]->(r:EvidenceRequirement)-[:ABOUT]->(fact)<-[:HAS]-(p)
OPTIONAL MATCH (fact)-[:OF]->(i:Ingredient)
OPTIONAL MATCH (p)-[:HAS]->(q:Question)-[:RESOLVES]->(r)
RETURN r.id AS requirement_id, r.kind AS kind, r.state AS state, fact.id AS fact_id,
       coalesce(i.name, toLower(fact.label)) AS name, fact.happened_at AS day,
       collect(DISTINCT f.id) AS finding_ids, q
ORDER BY requirement_id
