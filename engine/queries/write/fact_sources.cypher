// FROM_SOURCE edges for one fact. Params: $pid, $id, $source_ids
MATCH (p:Patient {id: $pid})-[:HAS]->(f {id: $id})
UNWIND $source_ids AS sid
MATCH (p)-[:HAS]->(s:Source {id: sid})
MERGE (f)-[:FROM_SOURCE]->(s)
