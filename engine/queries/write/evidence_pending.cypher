// Seed: evidence received but not confirmed yet (shown on the timeline). ON CREATE only.
// Params: $pid, $event_id, $case_version, $change (JSON string)
MATCH (p:Patient {id: $pid})
MERGE (e:EvidenceEvent {id: $event_id})
ON CREATE SET e.patient_id = $pid, e.status = 'pending', e.case_version = $case_version, e.change = $change
MERGE (p)-[:HAS]->(e)
