// Mark an evidence event applied and keep its result, so re-sending the event_id replays it.
// Params: $pid, $event_id, $result (JSON string)
MATCH (p:Patient {id: $pid})-[:HAS]->(e:EvidenceEvent {id: $event_id})
SET e.status = 'applied', e.result = $result
