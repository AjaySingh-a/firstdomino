// Patient node. Params: $pid, $props
MERGE (p:Patient {id: $pid})
SET p += $props
