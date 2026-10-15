// Confirmed evidence change, in ONE query so FalkorDB applies it atomically (writes are serialised):
// compare-and-set on case_version, then append a fact version. No row back = stale case_version
// (the API answers 409) and nothing was written.
// The fact node keeps its id and edges and holds the current values. Every version is a FactVersion:
// the old one is kept (with superseded_at) and version n+1 SUPERSEDES version n.
// Params: $pid, $fact_id, $case_version, $fact_props, $old_id, $old_props, $new_props, $recorded_at,
//         $event_id, $event_props
MATCH (p:Patient {id: $pid})-[:HAS]->(fact {id: $fact_id})
WHERE (fact:MedicationEpisode OR fact:Observation) AND p.case_version = $case_version
SET p.case_version = $case_version + 1
SET fact += $fact_props
MERGE (old:FactVersion {id: $old_id})
ON CREATE SET old += $old_props
SET old.superseded_at = $recorded_at
MERGE (fact)-[:VERSION]->(old)
CREATE (new:FactVersion)
SET new += $new_props
CREATE (fact)-[:VERSION]->(new), (new)-[:SUPERSEDES]->(old)
MERGE (e:EvidenceEvent {id: $event_id})
SET e += $event_props
MERGE (p)-[:HAS]->(e)
CREATE (e)-[:RECORDED]->(new)
RETURN p.case_version AS case_version
