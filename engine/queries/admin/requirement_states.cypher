// Admin: requirement states of one patient. Params: $pid
MATCH (r:EvidenceRequirement)
WHERE r.patient_id = $pid
RETURN r.id AS id, r.state AS state
ORDER BY id
