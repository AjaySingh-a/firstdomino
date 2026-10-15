// Q8 · one evidence event of this patient. An applied event keeps its result, so re-sending the
// same event_id replays it instead of writing again.
// Params: $pid, $event_id
MATCH (p:Patient {id: $pid})-[:HAS]->(e:EvidenceEvent {id: $event_id})
RETURN e
