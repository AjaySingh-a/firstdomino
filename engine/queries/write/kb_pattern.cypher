// Knowledge: a curated, cited pattern. evidence_refs is a JSON string (no map properties in FalkorDB).
// Params: $id, $version, $title, $window_days, $requires, $evidence_refs, $index_class, $via_effect, $marker_class
MERGE (pat:Pattern {id: $id})
SET pat.version = $version, pat.title = $title, pat.window_days = $window_days,
    pat.requires = $requires, pat.evidence_refs = $evidence_refs
MERGE (ic:DrugClass {code: $index_class})
MERGE (e:Effect {name: $via_effect})
MERGE (mc:DrugClass {code: $marker_class})
MERGE (pat)-[:INDEX]->(ic)
MERGE (pat)-[:VIA]->(e)
MERGE (pat)-[:MARKER]->(mc)
