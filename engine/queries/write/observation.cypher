// Observation (e.g. ankle swelling). Params: $pid, $id, $props, $effect
MATCH (p:Patient {id: $pid})
MATCH (e:Effect {name: $effect})
MERGE (o:Observation {id: $id})
SET o += $props
MERGE (p)-[:HAS]->(o)
MERGE (o)-[:OF_EFFECT]->(e)
