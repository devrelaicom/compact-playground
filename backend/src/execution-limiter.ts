import { getConfig } from "./config.js";

const MAX_QUEUE_SIZE = 100;

export class ExecutionQueueFullError extends Error {
  constructor() {
    super("Execution queue is full");
    this.name = "ExecutionQueueFullError";
  }
}

let activeExecutions = 0;
const waitQueue: Array<() => void> = [];

export async function acquireExecutionSlot(): Promise<void> {
  const maxConcurrentExecutions = getConfig().maxConcurrentExecutions;

  if (activeExecutions < maxConcurrentExecutions) {
    activeExecutions++;
    return;
  }

  if (waitQueue.length >= MAX_QUEUE_SIZE) {
    throw new ExecutionQueueFullError();
  }

  await new Promise<void>((resolve) => {
    waitQueue.push(() => {
      activeExecutions++;
      resolve();
    });
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
