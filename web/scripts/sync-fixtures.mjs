// Copies the stub API's snapshot and the named Cypher queries into lib/fixtures/.
//   data/snapshots/fixtures.json -> lib/fixtures/fixtures.json  (regenerate: uv run python -m api.snapshots)
//   engine/queries/*.cypher      -> lib/fixtures/queries.json   (shown in the investigation drawer)
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const out = resolve(here, "../lib/fixtures");
mkdirSync(out, { recursive: true });

// On Vercel the project's root directory is web/, so ../data and ../engine are only there when the
// project setting "Include files outside the root directory in the Build Step" is on.
for (const need of ["data/snapshots/fixtures.json", "engine/queries"]) {
  if (!existsSync(resolve(repo, need))) {
    console.error(
      `sync-fixtures: ${need} is missing next to web/. Build from the repo root, and on Vercel enable ` +
        `"Include files outside the root directory in the Build Step" (sourceFilesOutsideRootDirectory).`,
    );
    process.exit(1);
  }
}

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
