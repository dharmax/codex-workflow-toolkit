#!/usr/bin/env node

import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs, printAndExit } from "./lib/cli.mjs";
import { resolveOperatingContext } from "../../../core/lib/operating-context.mjs";

const HELP = `Usage:
  node runtime/scripts/codex-workflow/tutorial-web.mjs [--port 4310] [--host 127.0.0.1]

Options:
  --port <n>          Port to bind. Defaults to 4310. Use 0 for an ephemeral port.
  --host <host>       Host to bind. Defaults to 127.0.0.1.
  --mode <name>       Operating mode context to display.
  --root <path>       Repair target root override.
  --evidence-root <path>
                      Evidence root override.
  --json              Print server metadata as JSON once started.
`;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printAndExit(HELP);
}

const host = String(args.host ?? "127.0.0.1");
const parsedPort = Number.parseInt(String(args.port ?? "4310"), 10);
const port = Number.isFinite(parsedPort) ? Math.max(0, parsedPort) : 4310;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.resolve(scriptDir, "../../web/tutorial/index.html");
const pageHtml = await readFile(pagePath, "utf8");
const context = await resolveOperatingContext({
  cwd: process.cwd(),
  mode: args.mode ? String(args.mode) : null,
  root: args.root ? String(args.root) : null,
  evidenceRoot: args["evidence-root"] ? String(args["evidence-root"]) : null,
  allowExternalTarget: true
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}:${actualPort}`);
  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(pageHtml);
    return;
  }

  if (url.pathname === "/api/tutorial") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      mode: context.mode,
      toolkitRoot: context.toolkitRoot,
      repairTargetRoot: context.repairTargetRoot,
      evidenceRoot: context.evidenceRoot,
      url: `http://${host}:${actualPort}/`
    }, null, 2));
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

let actualPort = port;
server.listen(port, host, () => {
  const address = server.address();
  actualPort = typeof address === "object" && address ? address.port : port;
  const payload = {
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}/`,
    mode: context.mode,
    repairTargetRoot: context.repairTargetRoot,
    evidenceRoot: context.evidenceRoot
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write([
    `Tutorial web server listening on ${payload.url}`,
    `Mode: ${payload.mode}`,
    `Repair target: ${payload.repairTargetRoot}`,
    `Evidence root: ${payload.evidenceRoot}`
  ].join("\n") + "\n");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
