// CITES: the observations, then the sources behind every linked fact. Params: $pid, $fid, $observation_ids
MATCH (p:Patient {id: $pid})-[:HAS]->(f:Finding {id: $fid})
OPTIONAL MATCH (p)-[:HAS]->(o:Observation)
WHERE o.id IN $observation_ids
FOREACH (x IN CASE WHEN o IS NULL THEN [] ELSE [o] END | MERGE (f)-[:CITES]->(x))
WITH DISTINCT p, f
MATCH (f)-[:FROM|TO|CITES]->(x)-[:FROM_SOURCE]->(s:Source)<-[:HAS]-(p)
MERGE (f)-[:CITES]->(s)
