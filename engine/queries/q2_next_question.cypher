// Q2 · next question: the missing fact that the most open findings for this patient depend on.
// Params: $pid
// FalkorDB 4.22: the pattern predicate in WHERE works.
MATCH (p:Patient {id: $pid})-[:HAS]->(fact)<-[:ABOUT]-(r:EvidenceRequirement {state: 'missing'})<-[:NEEDS]-(f:Finding)
WHERE f.status IN ['needs_evidence', 'needs_reassessment', 'competing_explanation', 'candidate']
  AND NOT (r)<-[:RESOLVES]-(:Question)
WITH fact, r, count(DISTINCT f) AS findings_waiting, collect(DISTINCT f.id) AS finding_ids
RETURN fact.id AS fact_id, r.id AS requirement_id, r.kind AS requirement, r.field AS field,
       findings_waiting, finding_ids
ORDER BY findings_waiting DESC, requirement, requirement_id
LIMIT 1
