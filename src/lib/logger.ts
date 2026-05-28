type LogPayload = string | number | boolean | Record<string, unknown>;

type LogDestination = "stdout" | "stderr";

let logsAllEnabled = false;
let logDestination: LogDestination = "stdout";

export function configureLogs(
  mode?: string,
  destination: LogDestination = "stdout",
) {
  logsAllEnabled = mode === "all";
  logDestination = destination;
  return logsAllEnabled;
}

export function isAllLogsEnabled() {
  return logsAllEnabled;
}

function stringifyPayload(payload: LogPayload) {
  if (typeof payload === "string") {
    return payload;
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function writeLogLine(message: string) {
  if (logDestination === "stderr") {
    console.error(message);
    return;
  }

  console.log(message);
}

export function logAll(scope: string, message: string, payload?: LogPayload) {
  if (!logsAllEnabled) {
    return;
  }

  const timestamp = new Date().toISOString();
  const suffix = payload === undefined ? "" : ` ${stringifyPayload(payload)}`;
  writeLogLine(`[${timestamp}] [${scope}] ${message}${suffix}`);
}

export function logAllError(scope: string, message: string, error: unknown) {
  if (!logsAllEnabled) {
    return;
  }

  const details =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : error;
  logAll(scope, message, details as LogPayload);
}
