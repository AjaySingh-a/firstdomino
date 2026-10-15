// Copies the stub API's snapshot and the named Cypher queries into lib/fixtures/.
//   data/snapshots/fixtures.json -> lib/fixtures/fixtures.json  (regenerate: uv run python -m api.snapshots)
//   engine/queries/*.cypher      -> lib/fixtures/queries.json   (shown in the investigation drawer)
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const out = resolve(here, "../lib/fixtures");
mkdirSync(out, { recursive: true });

copyFileSync(resolve(repo, "data/snapshots/fixtures.json"), resolve(out, "fixtures.json"));

const queryDir = resolve(repo, "engine/queries");
const queries = Object.fromEntries(
  readdirSync(queryDir)
    .filter((f) => f.endsWith(".cypher"))
    .sort()
    .map((f) => [f.replace(/\.cypher$/, ""), readFileSync(resolve(queryDir, f), "utf8").replace(/\r\n/g, "\n")]),
);
writeFileSync(resolve(out, "queries.json"), JSON.stringify(queries, null, 2) + "\n");
console.log(`fixtures: snapshot + ${Object.keys(queries).length} queries -> ${out}`);
