import type { Server } from "node:net";
import { log } from "./logger.js";

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
  log.info("{signal} received, shutting down gracefully...", { signal });

  server.close(() => {
    log.info("All connections closed, exiting");
    process.exit(0);
  });

  // Force exit if connections don't drain in time
  setTimeout(() => {
    log.warn("Shutdown timed out after {timeout}ms, forcing exit", {
      timeout: SHUTDOWN_TIMEOUT_MS,
    });
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
