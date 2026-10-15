// Finding from engine/rules.py. ON CREATE only: reloading never rewrites an evaluated finding.
// Params: $pid, $fid, $index_ep, $marker_ep, $pattern_id, $status, $pattern_version, $eval_version, $headline
MATCH (p:Patient {id: $pid})-[:HAS]->(a:MedicationEpisode {id: $index_ep})
MATCH (p)-[:HAS]->(b:MedicationEpisode {id: $marker_ep})
MATCH (pat:Pattern {id: $pattern_id})
MERGE (f:Finding {id: $fid})
ON CREATE SET f.patient_id = $pid, f.status = $status, f.revision_n = 1,
              f.pattern_version = $pattern_version, f.eval_version = $eval_version, f.headline = $headline
MERGE (p)-[:HAS]->(f)
MERGE (f)-[:FROM]->(a)
MERGE (f)-[:TO]->(b)
MERGE (f)-[:MATCHES]->(pat)
RETURN f.id AS fid, f.status AS status
