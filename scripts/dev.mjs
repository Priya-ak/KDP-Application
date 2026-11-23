// Runs the API (with its embedded worker) and the Vite dev server together.
import { spawn } from "node:child_process";

const isWin = process.platform === "win32";
const procs = [
  spawn(isWin ? "npx.cmd" : "npx", ["tsx", "watch", "--clear-screen=false", "server/main.ts"], { stdio: "inherit", shell: isWin }),
  spawn(isWin ? "npx.cmd" : "npx", ["vite"], { stdio: "inherit", shell: isWin }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", (code) => { if (code) { stop(); process.exit(code); } }));
