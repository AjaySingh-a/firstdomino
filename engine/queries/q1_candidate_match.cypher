// Q1 · candidate match for ONE patient: returns the facts and their states.
// Python rules (engine/rules.py, tested) decide the status; Cypher never asserts a cause.
// Params: $pid
// FalkorDB 4.22: comma-separated patterns work. collect([...]) over an empty OPTIONAL MATCH yields
// [[null, ...]], so engine/rules.py drops entries whose id is null.
MATCH (p:Patient {id: $pid})-[:HAS]->(a:MedicationEpisode)-[:OF]->(ai:Ingredient)-[:IN_CLASS]->(:DrugClass)<-[:INDEX]-(pat:Pattern),
      (pat)-[:MARKER]->(:DrugClass)<-[:IN_CLASS]-(bi:Ingredient)<-[:OF]-(b:MedicationEpisode)<-[:HAS]-(p),
      (pat)-[:VIA]->(e:Effect)
WHERE a <> b
OPTIONAL MATCH (p)-[:HAS]->(o:Observation)-[:OF_EFFECT]->(e)
RETURN a.id AS index_ep, ai.name AS a_name, a.happened_at AS a_start, a.state AS a_state,
       b.id AS marker_ep, bi.name AS b_name, b.happened_at AS b_start, b.state AS b_state,
       b.indication AS b_indication, b.indication_state AS b_ind_state,
       pat.id AS pattern, pat.version AS pattern_version, pat.window_days AS window_days,
       pat.requires AS requires, e.name AS effect,
       collect([o.id, o.happened_at, o.state, o.label]) AS observations
ORDER BY pattern, index_ep, marker_ep
