// Bundles the server into dist/server (dependencies stay external) and copies SQL migrations.
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

await build({
  entryPoints: ["server/main.ts", "server/cli/migrate.ts"],
  outdir: "dist/server",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
  entryNames: "[name]",
  logLevel: "info",
});
mkdirSync("dist/server/migrations", { recursive: true });
cpSync("server/db/migrations", "dist/server/migrations", { recursive: true });
console.log("server bundle written to dist/server");
