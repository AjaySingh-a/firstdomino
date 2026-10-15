// Copy lint: fails the build if user-facing code or data uses forbidden phrasing.
// Findings are possible patterns for a clinician to review; the UI never reassures or instructs.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const SCAN = ["app", "components", "lib"];
const EXT = new Set([".ts", ".tsx", ".json", ".css", ".md"]);
const RULES = [
  [/\bsafe\b/i, '"safe"'],
  [/\bstop\s+taking\b/i, '"stop taking"'],
  [/\bcleared\b/i, '"cleared"'],
  [/\bcaused\s+by\b/i, '"caused by"'],
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXT.has(extname(p))) yield p;
  }
}

const hits = [];
for (const dir of SCAN) {
  for (const file of walk(resolve(root, dir))) {
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        for (const [re, word] of RULES) {
          if (re.test(line)) hits.push(`${relative(root, file)}:${i + 1}  ${word}  ${line.trim().slice(0, 100)}`);
        }
      });
  }
}

if (hits.length) {
  console.error(`copy-lint: ${hits.length} forbidden phrase(s). Rewrite as a possible pattern for review.\n`);
  console.error(hits.join("\n"));
  process.exit(1);
}
console.log("copy-lint: ok");
