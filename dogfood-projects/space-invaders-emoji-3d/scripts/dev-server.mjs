#!/usr/bin/env node

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preferredPort = Number.parseInt(String(process.env.PORT ?? "4173"), 10) || 4173;
const host = process.env.HOST || "127.0.0.1";

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".ico", "image/x-icon"]
]);

function resolveRequestPath(urlPath) {
  const pathname = decodeURIComponent(String(urlPath || "/").split("?")[0]);
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(root, "." + normalized);
  if (!filePath.startsWith(root)) {
    return null;
  }
  return filePath;
}

const server = http.createServer(async (request, response) => {
  const filePath = resolveRequestPath(request.url);
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES.get(path.extname(filePath)) || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    response.end(body);
  } catch (error) {
    if (error?.code === "ENOENT") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(500);
    response.end(String(error?.message ?? error));
  }
});

function start(port) {
  server.listen(port, host, () => {
    const address = server.address();
    const finalPort = typeof address === "object" && address ? address.port : port;
    process.stdout.write("Serving Emoji Star Lanes at http://" + host + ":" + finalPort + "\n");
  });
}

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    process.stderr.write("Port " + preferredPort + " is busy; falling back to a free port.\n");
    start(0);
    return;
  }
  throw error;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

start(preferredPort);
