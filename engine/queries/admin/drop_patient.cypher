// Admin: delete one patient and everything that belongs to it, for a per-story sandbox reset.
// Shared knowledge (Ingredient, DrugClass, Effect, Pattern) is kept; the seed loads the story again.
// Params: $pid
MATCH (p:Patient {id: $pid})
OPTIONAL MATCH (p)-[:HAS]->(x)
OPTIONAL MATCH (x)-[:VERSION]->(v:FactVersion)
OPTIONAL MATCH (x)-[:PRESCRIBED_BY]->(pr:Prescriber)
OPTIONAL MATCH (x)-[:NEEDS]->(r:EvidenceRequirement)
OPTIONAL MATCH (rev:FindingRevision)-[:OF]->(x)
OPTIONAL MATCH (d:ReviewDecision)-[:ON]->(rev)
WITH p, collect(DISTINCT x) + collect(DISTINCT v) + collect(DISTINCT pr) + collect(DISTINCT r)
        + collect(DISTINCT rev) + collect(DISTINCT d) AS owned
FOREACH (n IN owned | DETACH DELETE n)
DETACH DELETE p
RETURN size(owned) AS deleted
