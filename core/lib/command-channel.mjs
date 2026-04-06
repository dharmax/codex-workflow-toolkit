const DIRECT_COMMAND_CHANNEL = "direct";
const SHELL_COMMAND_CHANNEL = "shell";

export function normalizeCommandChannel(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === SHELL_COMMAND_CHANNEL) {
    return SHELL_COMMAND_CHANNEL;
  }
  return DIRECT_COMMAND_CHANNEL;
}

export function getCommandChannel() {
  return normalizeCommandChannel(process.env.AIWF_COMMAND_CHANNEL);
}

export function isDirectCommandChannel() {
  return getCommandChannel() === DIRECT_COMMAND_CHANNEL;
}

export function assertDirectCommandChannel(operation) {
  if (!isDirectCommandChannel()) {
    throw new Error(`${operation} must be run from the regular ai-workflow CLI, not the conversational shell.`);
  }
}
