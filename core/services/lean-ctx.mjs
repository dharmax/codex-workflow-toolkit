import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function probeLeanCtx() {
  try {
    const { stdout } = await execFileAsync("bash", ["-lc", "command -v lean-ctx"], {
      maxBuffer: 1024 * 1024
    });
    const commandPath = String(stdout ?? "").trim();
    if (!commandPath) {
      return {
        installed: false,
        path: null,
        details: "lean-ctx not found on PATH"
      };
    }

    const version = await probeLeanCtxVersion();
    return {
      installed: true,
      path: commandPath,
      version,
      details: `lean-ctx available at ${commandPath}${version ? ` (${version})` : ""}`
    };
  } catch (error) {
    return {
      installed: false,
      path: null,
      version: null,
      details: error?.message ?? String(error)
    };
  }
}

export async function probeLeanCtxVersion() {
  try {
    const { stdout } = await execFileAsync("lean-ctx", ["--version"], {
      maxBuffer: 1024 * 1024
    });
    const version = normalizeVersion(String(stdout ?? ""));
    return version;
  } catch {
    return null;
  }
}

export function leanCtxInstallHint() {
  return "Install the lean-ctx CLI and ensure `lean-ctx` is on PATH, then rerun `ai-workflow doctor`.";
}

export function leanCtxSetupHint() {
  return "After install, verify with `lean-ctx -c git status` and use `lean-ctx -c <command>` for compressed shell output.";
}

function normalizeVersion(text) {
  const match = String(text ?? "").match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match ? match[1] : String(text ?? "").trim() || null;
}
