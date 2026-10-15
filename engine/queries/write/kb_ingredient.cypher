// Knowledge: an ingredient and its ATC class. Params: $name, $rxcui, $drug_class
MERGE (c:DrugClass {code: $drug_class})
MERGE (i:Ingredient {name: $name})
SET i.rxcui = $rxcui
MERGE (i)-[:IN_CLASS]->(c)
