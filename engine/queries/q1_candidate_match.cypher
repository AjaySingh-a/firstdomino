// Q1 · candidate match for ONE patient: returns the facts and their states.
// Python rules (engine/rules.py, tested) decide the status; Cypher never asserts a cause.
// Params: $pid
// TODO(Dev, Day 1): check comma-separated patterns and collect() over an empty OPTIONAL MATCH
// (it yields [[null, null, null]]) on FalkorDB.
MATCH (p:Patient {id: $pid})-[:HAS]->(a:MedicationEpisode)-[:OF]->(:Ingredient)-[:IN_CLASS]->(:DrugClass)<-[:INDEX]-(pat:Pattern),
      (pat)-[:MARKER]->(:DrugClass)<-[:IN_CLASS]-(:Ingredient)<-[:OF]-(b:MedicationEpisode)<-[:HAS]-(p),
      (pat)-[:VIA]->(e:Effect)
WHERE a <> b
OPTIONAL MATCH (p)-[:HAS]->(o:Observation)-[:OF_EFFECT]->(e)
RETURN a.id AS index_ep, a.happened_at AS a_start, a.state AS a_state,
       b.id AS marker_ep, b.happened_at AS b_start, b.state AS b_state,
       b.indication AS b_indication, b.indication_state AS b_ind_state,
       pat.id AS pattern, pat.version AS pattern_version, pat.window_days AS window_days,
       e.name AS effect,
       collect([o.id, o.happened_at, o.state]) AS observations
