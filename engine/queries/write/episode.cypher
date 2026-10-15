// Medication episode. Null props are removed, so an unknown day stays unknown.
// Params: $pid, $id, $props, $ingredient
MATCH (p:Patient {id: $pid})
MATCH (i:Ingredient {name: $ingredient})
MERGE (ep:MedicationEpisode {id: $id})
SET ep += $props
MERGE (p)-[:HAS]->(ep)
MERGE (ep)-[:OF]->(i)
