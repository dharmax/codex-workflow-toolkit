import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function executeCodelet(codelet, args = [], { cwd = process.cwd(), env = process.env, mode = "stream" } = {}) {
  const entry = codelet.entryPath ?? (codelet.entry ? path.resolve(cwd, codelet.entry) : null);
  if (codelet.runner !== "node-script") {
    throw new Error(`Unsupported codelet runner: ${codelet.runner}`);
  }
  if (!entry) {
    throw new Error(`Codelet ${codelet.id} is missing an executable entry.`);
  }

  if (mode !== "capture" && isJsExecutionCodelet(codelet, entry)) {
    const inProcess = await tryRunInProcess(entry, args, { env });
    if (inProcess.used) {
      return typeof inProcess.result === "number" ? inProcess.result : 0;
    }
  }

  return mode === "capture"
    ? runNodeScriptCaptured(entry, args, { cwd, env })
    : runNodeScriptStreamed(entry, args, { cwd, env });
}

function isJsExecutionCodelet(codelet, entry) {
  return codelet.execution === "js"
    || codelet.runtime === "js"
    || String(entry ?? "").includes("smart-codelet-runner.mjs");
}

async function tryRunInProcess(entry, args, { env }) {
  const module = await import(pathToFileURL(entry).href);
  const runner = module.runSmartCodelet ?? module.runCodelet ?? module.main ?? module.default;
  if (typeof runner !== "function") {
    return { used: false, result: null };
  }

  const result = await runner(args, env);
  return { used: true, result };
}

async function runNodeScriptCaptured(scriptPath, args, { cwd, env }) {
  return mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "ai-workflow-codelet-")).then(async (captureDir) => {
    const stdoutPath = path.join(captureDir, "stdout.log");
    const stderrPath = path.join(captureDir, "stderr.log");
    const command = `${shellQuote(process.execPath)} ${[scriptPath, ...args].map(shellQuote).join(" ")} > ${shellQuote(stdoutPath)} 2> ${shellQuote(stderrPath)}`;

    try {
      await execFileAsync("/usr/bin/bash", ["-lc", command], {
        cwd,
        maxBuffer: 16 * 1024 * 1024,
        env
      });
      const stdout = await readFile(stdoutPath, "utf8").catch(() => "");
      const stderr = await readFile(stderrPath, "utf8").catch(() => "");
      return `${stdout}${stderr}`.trimEnd() + "\n";
    } finally {
      await rm(captureDir, { recursive: true, force: true });
    }
  });
}

async function runNodeScriptStreamed(scriptPath, args, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      stdio: "inherit",
      env
    });

    child.on("exit", (code) => {
      resolve(code ?? 0);
    });
    child.on("error", (error) => {
      process.stderr.write(`${error.message}\n`);
      resolve(1);
    });
  });
}

function shellQuote(value) {
  return JSON.stringify(String(value));
}
