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

    return {
      installed: true,
      path: commandPath,
      details: `lean-ctx available at ${commandPath}`
    };
  } catch (error) {
    return {
      installed: false,
      path: null,
      details: error?.message ?? String(error)
    };
  }
}

export function leanCtxInstallHint() {
  return "Install the lean-ctx CLI and ensure `lean-ctx` is on PATH, then rerun `ai-workflow doctor`.";
}

export function leanCtxSetupHint() {
  return "After install, verify with `lean-ctx -c git status` and use `lean-ctx -c <command>` for compressed shell output.";
}
