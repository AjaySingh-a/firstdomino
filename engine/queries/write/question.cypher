// Record that the question for one open requirement was asked, in ONE query: compare-and-set on
// case_version, and only while the requirement is still missing and has no question yet.
// No row back = stale case_version, a requirement that is no longer open, or already asked.
// Params: $pid, $rid, $case_version, $props (the Question)
MATCH (p:Patient {id: $pid})-[:HAS]->(:Finding)-[:NEEDS]->(r:EvidenceRequirement {id: $rid})
WHERE p.case_version = $case_version AND r.state = 'missing' AND NOT (r)<-[:RESOLVES]-(:Question)
WITH DISTINCT p, r
SET p.case_version = $case_version + 1
CREATE (q:Question)
SET q += $props
CREATE (p)-[:HAS]->(q), (q)-[:RESOLVES]->(r)
RETURN q, p.case_version AS case_version
