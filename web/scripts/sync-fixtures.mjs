// Copies data/snapshots/fixtures.json (the stub API's real responses) into lib/fixtures/.
// Regenerate the source with: uv run python -m api.snapshots
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../data/snapshots/fixtures.json");
const dest = resolve(here, "../lib/fixtures/fixtures.json");
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`fixtures: ${src} -> ${dest}`);
