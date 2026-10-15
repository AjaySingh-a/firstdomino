// Prescriber, patient-scoped so no node is shared between patients. Params: $pid, $ep_id, $id, $specialty
MATCH (p:Patient {id: $pid})-[:HAS]->(ep:MedicationEpisode {id: $ep_id})
MERGE (pr:Prescriber {id: $id})
SET pr.specialty = $specialty
MERGE (ep)-[:PRESCRIBED_BY]->(pr)
