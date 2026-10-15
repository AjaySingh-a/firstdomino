// Q7 · timeline for one patient: the current version of every fact with its sources, the sources,
// and evidence that was received but is not confirmed yet. One row per item; `kind` says which.
// Params: $pid
MATCH (p:Patient {id: $pid})-[:HAS]->(ep:MedicationEpisode)-[:OF]->(i:Ingredient)-[:IN_CLASS]->(c:DrugClass)
OPTIONAL MATCH (ep)-[:PRESCRIBED_BY]->(pr:Prescriber)
OPTIONAL MATCH (ep)-[:FROM_SOURCE]->(s:Source)<-[:HAS]-(p)
RETURN 'episode' AS kind, ep AS node, i.name AS ingredient, i.rxcui AS rxcui, c.code AS drug_class,
       pr.specialty AS extra, collect(DISTINCT s.id) AS source_ids
UNION ALL
MATCH (p:Patient {id: $pid})-[:HAS]->(o:Observation)-[:OF_EFFECT]->(e:Effect)
OPTIONAL MATCH (o)-[:FROM_SOURCE]->(s:Source)<-[:HAS]-(p)
RETURN 'observation' AS kind, o AS node, null AS ingredient, null AS rxcui, null AS drug_class,
       e.name AS extra, collect(DISTINCT s.id) AS source_ids
UNION ALL
MATCH (p:Patient {id: $pid})-[:HAS]->(s:Source)
RETURN 'source' AS kind, s AS node, null AS ingredient, null AS rxcui, null AS drug_class,
       null AS extra, [] AS source_ids
UNION ALL
MATCH (p:Patient {id: $pid})-[:HAS]->(ev:EvidenceEvent {status: 'pending'})
RETURN 'pending' AS kind, ev AS node, null AS ingredient, null AS rxcui, null AS drug_class,
       null AS extra, [] AS source_ids
