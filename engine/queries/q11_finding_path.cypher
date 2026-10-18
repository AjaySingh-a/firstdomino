// Q11 · the walk behind ONE finding, returned as FalkorDB's own path (not rebuilt by the caller).
// walk: first medicine -[:OF]-> ingredient -[:IN_CLASS]-> class <-[:INDEX]- pattern -[:MARKER]-> class
//       <-[:IN_CLASS]- ingredient <-[:OF]- second medicine, in that order.
// sides: pattern -[:VIA]-> effect <-[:OF_EFFECT]- symptom, one path per symptom on record.
// The path explains a finding; engine/rules.py still decides its status.
// Params: $pid, $fid
MATCH (p:Patient {id: $pid})-[:HAS]->(f:Finding {id: $fid})-[:FROM]->(a:MedicationEpisode),
      (f)-[:TO]->(b:MedicationEpisode), (f)-[:MATCHES]->(pat:Pattern)
MATCH walk = (a)-[:OF]->(:Ingredient)-[:IN_CLASS]->(:DrugClass)<-[:INDEX]-(pat)
             -[:MARKER]->(:DrugClass)<-[:IN_CLASS]-(:Ingredient)<-[:OF]-(b)
OPTIONAL MATCH (p)-[:HAS]->(o:Observation)
OPTIONAL MATCH side = (pat)-[:VIA]->(:Effect)<-[:OF_EFFECT]-(o)
RETURN walk, collect(side) AS sides
