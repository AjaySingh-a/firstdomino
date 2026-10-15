// Q2 · next question: the missing fact that the most open findings for this patient depend on.
// Params: $pid
// TODO(Dev, Day 1): check the pattern predicate in WHERE (NOT (r)<-[:RESOLVES]-(:Question)) on FalkorDB.
MATCH (p:Patient {id: $pid})-[:HAS]->(fact)<-[:ABOUT]-(r:EvidenceRequirement {state: 'missing'})<-[:NEEDS]-(f:Finding)
WHERE f.status IN ['needs_evidence', 'needs_reassessment']
  AND NOT (r)<-[:RESOLVES]-(:Question)
RETURN fact.id AS fact_id, r.kind AS requirement, count(DISTINCT f) AS findings_waiting
ORDER BY findings_waiting DESC, requirement
LIMIT 1
