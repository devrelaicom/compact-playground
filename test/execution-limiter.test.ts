import { describe, it, expect, beforeEach } from "vitest";
import {
  acquireExecutionSlot,
  releaseExecutionSlot,
  resetExecutionLimiter,
  ExecutionQueueFullError,
} from "../backend/src/execution-limiter.js";
import { resetConfig } from "../backend/src/config.js";

describe("execution-limiter", () => {
  beforeEach(() => {
    resetExecutionLimiter();
    // Default config: maxConcurrentExecutions = 3
    process.env.MAX_CONCURRENT_EXECUTIONS = "2";
    resetConfig();
  });

  it("allows requests up to the concurrency limit", async () => {
    await acquireExecutionSlot();
    await acquireExecutionSlot();
    // Both should succeed without blocking
    releaseExecutionSlot();
    releaseExecutionSlot();
  });

  it("queues requests beyond the concurrency limit", async () => {
    await acquireExecutionSlot();
    await acquireExecutionSlot();

    let resolved = false;
    const queued = acquireExecutionSlot().then(() => {
      resolved = true;
    });

    // Give microtasks a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);

    // Release one slot — queued request should proceed
    releaseExecutionSlot();
    await queued;
    expect(resolved).toBe(true);

    releaseExecutionSlot();
    releaseExecutionSlot();
  });

  it("throws ExecutionQueueFullError when queue limit exceeded", async () => {
    process.env.MAX_CONCURRENT_EXECUTIONS = "1";
    resetConfig();

    // Fill the active slot
    await acquireExecutionSlot();

    // Fill the queue to capacity (100)
    const queuedPromises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      queuedPromises.push(acquireExecutionSlot());
    }

    // The 101st queued request should fail immediately
    await expect(acquireExecutionSlot()).rejects.toThrow(ExecutionQueueFullError);
    await expect(acquireExecutionSlot()).rejects.toThrow("Execution queue is full");

    // Drain: release all slots
    for (let i = 0; i < 101; i++) {
      releaseExecutionSlot();
    }
    await Promise.all(queuedPromises);
  });

  it("drains queue in FIFO order", async () => {
    process.env.MAX_CONCURRENT_EXECUTIONS = "1";
    resetConfig();

    await acquireExecutionSlot();

    const order: number[] = [];
    const p1 = acquireExecutionSlot().then(() => order.push(1));
    const p2 = acquireExecutionSlot().then(() => order.push(2));
    const p3 = acquireExecutionSlot().then(() => order.push(3));

    releaseExecutionSlot();
    await p1;
    releaseExecutionSlot();
    await p2;
    releaseExecutionSlot();
    await p3;

    expect(order).toEqual([1, 2, 3]);

    releaseExecutionSlot();
  });

  it("accounting is correct after queue-full rejection", async () => {
    process.env.MAX_CONCURRENT_EXECUTIONS = "1";
    resetConfig();

    await acquireExecutionSlot();

    // Fill queue
    const queuedPromises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      queuedPromises.push(acquireExecutionSlot());
    }

    // This should throw but not corrupt state
    await expect(acquireExecutionSlot()).rejects.toThrow(ExecutionQueueFullError);

    // Drain the queue — all should resolve
    for (let i = 0; i < 101; i++) {
      releaseExecutionSlot();
    }
    await Promise.all(queuedPromises);
  });
});
