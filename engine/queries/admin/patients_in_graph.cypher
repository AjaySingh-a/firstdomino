// Admin: which patients live in this family graph (used to route a patient to its graph).
MATCH (p:Patient)
RETURN p
ORDER BY p.id
