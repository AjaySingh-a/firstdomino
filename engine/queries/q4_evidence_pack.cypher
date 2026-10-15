// Q4 · evidence pack for the drawer: one row per linked fact, with its sources and open requirements.
// Params: $pid, $fid
MATCH (p:Patient {id: $pid})-[:HAS]->(f:Finding {id: $fid})-[:MATCHES]->(pat:Pattern)
MATCH (pat)-[:INDEX]->(ic:DrugClass), (pat)-[:VIA]->(e:Effect), (pat)-[:MARKER]->(mc:DrugClass)
MATCH (f)-[rel:FROM|TO|CITES]->(fact)<-[:HAS]-(p)
WHERE fact:MedicationEpisode OR fact:Observation
OPTIONAL MATCH (fact)-[:OF]->(i:Ingredient)-[:IN_CLASS]->(c:DrugClass)
OPTIONAL MATCH (fact)-[:FROM_SOURCE]->(s:Source)<-[:HAS]-(p)
OPTIONAL MATCH (f)-[:NEEDS]->(r:EvidenceRequirement)-[:ABOUT]->(fact)
RETURN f, pat, ic.code AS index_class, e.name AS via_effect, mc.code AS marker_class,
       type(rel) AS role, labels(fact)[0] AS label, fact,
       i.name AS ingredient, i.rxcui AS rxcui, c.code AS drug_class,
       collect(DISTINCT s) AS sources,
       collect(DISTINCT [r.id, r.kind, r.field, r.state]) AS requirements
ORDER BY role, fact.id
