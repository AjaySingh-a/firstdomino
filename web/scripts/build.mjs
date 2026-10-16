// `npm run build`: next build with NODE_ENV=production, whatever the calling shell has set.
// A shell with NODE_ENV=development would otherwise make Next build React's development bundle
// (and can fail prerendering). Vercel sets production itself; this keeps local builds the same.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const res = spawnSync(process.execPath, [next, "build"], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});
process.exit(res.status ?? 1);
