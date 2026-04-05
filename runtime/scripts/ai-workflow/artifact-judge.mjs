#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { runArtifactJudge } from "../../../core/services/artifact-verification.mjs";

export { runArtifactJudge };

const entryUrl = pathToFileURL(process.argv[1] ?? "").href;
if (process.env.AIWF_WRAPPED_RUNTIME === "1" || import.meta.url === entryUrl) {
  const exitCode = await runArtifactJudge();
  process.exitCode = exitCode && typeof exitCode === "number" ? exitCode : 0;
}

