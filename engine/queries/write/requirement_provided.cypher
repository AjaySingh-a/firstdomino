// Re-evaluation: requirements of this finding that the rules no longer need were met by the evidence.
// Params: $pid, $fid, $keep (requirement ids still open)
MATCH (p:Patient {id: $pid})-[:HAS]->(f:Finding {id: $fid})-[:NEEDS]->(r:EvidenceRequirement)
WHERE NOT r.id IN $keep AND r.state <> 'provided'
SET r.state = 'provided'
