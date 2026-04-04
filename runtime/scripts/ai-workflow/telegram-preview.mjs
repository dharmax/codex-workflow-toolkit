#!/usr/bin/env node

import { parseArgs } from "./lib/cli.mjs";
import { buildTelegramPreview } from "../../../core/services/telegram.mjs";

const args = parseArgs(process.argv.slice(2));
const preview = await buildTelegramPreview({ projectRoot: process.cwd() });

if (args.json) {
  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
} else {
  process.stdout.write(preview.text);
}
