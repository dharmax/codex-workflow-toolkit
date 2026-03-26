#!/usr/bin/env node

import { writeSync } from "node:fs";
import { main } from "./lib/main.mjs";

installSynchronousWrites(process.stdout);
installSynchronousWrites(process.stderr);

const code = await main(process.argv.slice(2));
process.exitCode = code;

function installSynchronousWrites(stream) {
  const originalWrite = stream.write.bind(stream);
  stream.write = (chunk, encoding, callback) => {
    let resolvedEncoding = encoding;
    let resolvedCallback = callback;

    if (typeof resolvedEncoding === "function") {
      resolvedCallback = resolvedEncoding;
      resolvedEncoding = undefined;
    }

    try {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), resolvedEncoding);
      writeSync(stream.fd, buffer);
      resolvedCallback?.(null);
      return true;
    } catch (error) {
      resolvedCallback?.(error);
      return originalWrite(chunk, encoding, callback);
    }
  };
}
