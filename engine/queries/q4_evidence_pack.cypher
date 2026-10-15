// Q4 · evidence pack for the drawer: documented, conflicting and unknown, with sources.
// Params: $pid, $fid
MATCH (p:Patient {id: $pid})
MATCH (f:Finding {id: $fid, patient_id: $pid})-[:MATCHES]->(pat:Pattern)
OPTIONAL MATCH (f)-[:CITES]->(c)-[:FROM_SOURCE]->(s:Source)
OPTIONAL MATCH (f)-[:NEEDS]->(r:EvidenceRequirement)-[:ABOUT]->(t)
RETURN f, pat, collect(DISTINCT c) AS cited, collect(DISTINCT s) AS sources,
       collect(DISTINCT [r.kind, r.state, t.id]) AS requirements
