// Admin: every stored version of one fact, oldest first, with the version each one supersedes.
// Params: $fact_id
MATCH (fact {id: $fact_id})-[:VERSION]->(v:FactVersion)
OPTIONAL MATCH (v)-[:SUPERSEDES]->(old:FactVersion)
RETURN v, old.n AS supersedes
ORDER BY v.n
