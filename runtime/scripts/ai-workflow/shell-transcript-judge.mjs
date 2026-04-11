#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { runShellTranscriptJudge } from "../../../core/services/shell-transcript-verification.mjs";

export { runShellTranscriptJudge };

const entryUrl = pathToFileURL(process.argv[1] ?? "").href;
if (process.env.AIWF_WRAPPED_RUNTIME === "1" || import.meta.url === entryUrl) {
  const exitCode = await runShellTranscriptJudge();
  process.exitCode = exitCode && typeof exitCode === "number" ? exitCode : 0;
}
