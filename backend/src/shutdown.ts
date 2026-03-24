import type { Server } from "node:net";

const SHUTDOWN_TIMEOUT_MS = 10_000; // 10 seconds

let shuttingDown = false;

export function isShuttingDown(): boolean {
  return shuttingDown;
}

/** Reset shutdown state (for testing only) */
export function resetShutdownState(): void {
  shuttingDown = false;
}

/**
 * Initiates a graceful shutdown: closes the server, waits for connections
 * to drain, and exits. Safe to call multiple times (only the first call acts).
 */
export function initiateShutdown(server: Server, signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully...`);

  server.close(() => {
    console.log("All connections closed, exiting");
    process.exit(0);
  });

  // Force exit if connections don't drain in time
  setTimeout(() => {
    console.warn(`Shutdown timed out after ${String(SHUTDOWN_TIMEOUT_MS)}ms, forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
}

/**
 * Registers SIGTERM and SIGINT handlers that trigger graceful shutdown.
 */
export function registerShutdownHandlers(server: Server): void {
  process.on("SIGTERM", () => {
    initiateShutdown(server, "SIGTERM");
  });
  process.on("SIGINT", () => {
    initiateShutdown(server, "SIGINT");
  });
}
