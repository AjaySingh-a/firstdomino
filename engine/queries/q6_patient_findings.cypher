// Q6 · findings list for one patient, with the IDs each finding links to.
// Params: $pid
MATCH (p:Patient {id: $pid})-[:HAS]->(f:Finding)-[:MATCHES]->(pat:Pattern)-[:VIA]->(e:Effect)
MATCH (f)-[:FROM]->(a:MedicationEpisode)<-[:HAS]-(p), (f)-[:TO]->(b:MedicationEpisode)<-[:HAS]-(p)
OPTIONAL MATCH (f)-[:CITES]->(o:Observation)<-[:HAS]-(p)
WITH p, f, pat, e, a, b, collect(DISTINCT o.id) AS observation_ids
OPTIONAL MATCH (f)-[:CITES]->(s:Source)<-[:HAS]-(p)
WITH p, f, pat, e, a, b, observation_ids, collect(DISTINCT s) AS sources
OPTIONAL MATCH (f)-[:NEEDS]->(r:EvidenceRequirement)
RETURN f, pat.id AS pattern_id, e.name AS effect, a.id AS index_ep, b.id AS marker_ep,
       observation_ids, sources, collect(DISTINCT r.id) AS requirement_ids
ORDER BY f.id
