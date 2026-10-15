// Admin: node and edge counts by label/type (idempotency checks).
MATCH (n)
WITH labels(n)[0] AS label, count(n) AS nodes
RETURN 'node' AS kind, label AS name, nodes AS n
UNION ALL
MATCH ()-[r]->()
RETURN 'edge' AS kind, type(r) AS name, count(r) AS n
