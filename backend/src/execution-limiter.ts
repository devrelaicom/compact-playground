import { getConfig } from "./config.js";

let activeExecutions = 0;
const waitQueue: Array<() => void> = [];

export async function acquireExecutionSlot(): Promise<void> {
  const maxConcurrentExecutions = getConfig().maxConcurrentExecutions;

  if (activeExecutions < maxConcurrentExecutions) {
    activeExecutions++;
    return;
  }

  await new Promise<void>((resolve) => {
    waitQueue.push(() => {
      activeExecutions++;
      resolve();
    });
  });
}

export function releaseExecutionSlot(): void {
  if (activeExecutions > 0) {
    activeExecutions--;
  }

  const next = waitQueue.shift();
  if (next) {
    next();
  }
}

export function resetExecutionLimiter(): void {
  activeExecutions = 0;
  waitQueue.length = 0;
}
