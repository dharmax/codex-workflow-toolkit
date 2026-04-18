#!/usr/bin/env node
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["/home/dharmax/work/ai-workflow/runtime/scripts/ai-workflow/review-summary.mjs", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
