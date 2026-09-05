// Runs the Supabase CLI against the project's database using SUPABASE_DB_URL from .env.local.
//   npm run db:push   apply supabase/migrations to the remote database
//   npm run db:types  regenerate lib/supabase/types.ts (needs Docker running)
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import nextEnv from "@next/env"; // CommonJS package: default import, then destructure

nextEnv.loadEnvConfig(process.cwd(), true);

const command = process.argv[2];
const dbUrl = process.env.SUPABASE_DB_URL;

if (!["push", "types"].includes(command)) {
  console.error("usage: node scripts/supabase-db.mjs <push|types>");
  process.exit(2);
}
if (!dbUrl) {
  console.error("SUPABASE_DB_URL is not set. Add the session-pooler connection string to .env.local (see .env.example).");
  process.exit(1);
}

// The `supabase` npm package exposes its CLI through dist/supabase.js (see its package.json "bin").
const require = createRequire(import.meta.url);
const cliEntry = path.join(path.dirname(require.resolve("supabase/package.json")), "dist", "supabase.js");
if (!existsSync(cliEntry)) {
  console.error(`Supabase CLI not found at ${cliEntry}. Run npm install.`);
  process.exit(1);
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [cliEntry, ...args], { encoding: "utf8", ...options });
}

if (command === "push") {
  const result = run(["db", "push", "--db-url", dbUrl, "--yes"], { stdio: "inherit", encoding: undefined });
  process.exit(result.status ?? 1);
}

const result = run(["gen", "types", "typescript", "--db-url", dbUrl, "--schema", "public"]);
if (result.status !== 0 || !result.stdout?.trim()) {
  process.stderr.write(result.stderr ?? "");
  console.error("Type generation failed. The Supabase CLI runs this step in Docker; start Docker Desktop and retry.");
  process.exit(result.status ?? 1);
}

const target = path.join(process.cwd(), "lib", "supabase", "types.ts");
const header = [
  "/**",
  " * Database types for supabase-js, generated from the live schema by `npm run db:types`.",
  " * Do not edit by hand; change a migration and regenerate.",
  " */",
  "",
].join("\n");
writeFileSync(target, header + result.stdout);
console.log(`wrote ${path.relative(process.cwd(), target)}`);
