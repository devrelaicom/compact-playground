import { getConfig } from "./config.js";
import { RequestAbortedError } from "./process-utils.js";

export class ExecutionQueueFullError extends Error {
  constructor() {
    super("Execution queue is full");
    this.name = "ExecutionQueueFullError";
  }
}

let activeExecutions = 0;
const waitQueue: Array<() => void> = [];

export async function acquireExecutionSlot(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new RequestAbortedError();
  }

  const { maxConcurrentExecutions, maxQueueSize } = getConfig();

  if (activeExecutions < maxConcurrentExecutions) {
    activeExecutions++;
    return;
  }

  if (waitQueue.length >= maxQueueSize) {
    throw new ExecutionQueueFullError();
  }

  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      signal?.removeEventListener("abort", onAbort);
      activeExecutions++;
      resolve();
    };

    const onAbort = () => {
      const index = waitQueue.indexOf(onReady);
      if (index >= 0) {
        waitQueue.splice(index, 1);
      }
      reject(new RequestAbortedError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    waitQueue.push(onReady);
  });
}

export function releaseExecutionSlot(): void {
  if (activeExecutions <= 0) {
    return;
  }

  activeExecutions--;

  const next = waitQueue.shift();
  if (next) {
    next();
  }
}

export function resetExecutionLimiter(): void {
  activeExecutions = 0;
  waitQueue.length = 0;
}
