import type { ChildProcessWithoutNullStreams } from "node:child_process";

const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024; // 2MB

export class ProcessOutputLimitError extends Error {
  constructor(maxBytes: number = DEFAULT_MAX_OUTPUT_BYTES) {
    super(`Process output exceeded ${String(maxBytes)} bytes`);
    this.name = "ProcessOutputLimitError";
  }
}

export class RequestAbortedError extends Error {
  constructor() {
    super("Request was aborted");
    this.name = "RequestAbortedError";
  }
}

export function buildChildProcessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    TERM: "dumb",
  };

  for (const key of ["PATH", "HOME", "COMPACT_DIRECTORY", "TMPDIR", "TEMP", "TMP"]) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }

  return env;
}

export function attachCappedOutput(
  proc: ChildProcessWithoutNullStreams,
  maxBytes: number = DEFAULT_MAX_OUTPUT_BYTES,
): {
  getStdout: () => string;
  getStderr: () => string;
  wasLimitExceeded: () => boolean;
} {
  let stdout = "";
  let stderr = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let limitExceeded = false;

  const killForLimit = () => {
    if (limitExceeded) return;
    limitExceeded = true;
    proc.kill("SIGTERM");
    setTimeout(() => {
      proc.kill("SIGKILL");
    }, 2000).unref();
  };

  proc.stdout.on("data", (data: Buffer) => {
    if (limitExceeded) return;
    stdoutBytes += data.length;
    if (stdoutBytes > maxBytes) {
      killForLimit();
      return;
    }
    stdout += data.toString();
  });

  proc.stderr.on("data", (data: Buffer) => {
    if (limitExceeded) return;
    stderrBytes += data.length;
    if (stderrBytes > maxBytes) {
      killForLimit();
      return;
    }
    stderr += data.toString();
  });

  return {
    getStdout: () => stdout,
    getStderr: () => stderr,
    wasLimitExceeded: () => limitExceeded,
  };
}
