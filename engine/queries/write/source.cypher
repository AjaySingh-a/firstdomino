// Source of a patient fact. Params: $pid, $id, $props
MATCH (p:Patient {id: $pid})
MERGE (s:Source {id: $id})
SET s += $props
MERGE (p)-[:HAS]->(s)
