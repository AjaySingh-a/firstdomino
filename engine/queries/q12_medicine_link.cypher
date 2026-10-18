// Q12 · the shortest connection between two of ONE patient's medicines through the knowledge layer only,
// found by a FalkorDB path algorithm (algo.SPpaths, undirected, edge types OF | IN_CLASS | INDEX | MARKER).
// It never crosses HAS or the Patient node, so it can only link the two medicines through their
// ingredients, ATC classes and a cited pattern. No row in `paths` means the graph holds no such
// connection: a lookalike in another class (diltiazem, C08DB) has none.
// FalkorDB 4.22: the CALL {} subquery keeps one row (with both classes) when the algorithm finds no path.
// Params: $pid, $a, $b (MedicationEpisode ids)
MATCH (p:Patient {id: $pid})-[:HAS]->(a:MedicationEpisode {id: $a})-[:OF]->(ai:Ingredient)-[:IN_CLASS]->(ac:DrugClass),
      (p)-[:HAS]->(b:MedicationEpisode {id: $b})-[:OF]->(bi:Ingredient)-[:IN_CLASS]->(bc:DrugClass)
CALL {
  WITH a, b
  CALL algo.SPpaths({sourceNode: a, targetNode: b, relTypes: ['OF', 'IN_CLASS', 'INDEX', 'MARKER'],
                     relDirection: 'both', maxLen: 8, pathCount: 1}) YIELD path
  RETURN collect(path) AS paths
}
RETURN ai.name AS a_name, ac.code AS a_class, bi.name AS b_name, bc.code AS b_class, paths
