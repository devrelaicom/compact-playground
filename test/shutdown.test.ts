import { describe, it, expect, vi, beforeEach } from "vitest";
import { createServer } from "node:http";
import { isShuttingDown, initiateShutdown, resetShutdownState } from "../backend/src/shutdown.js";

describe("shutdown", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetShutdownState();
  });

  it("isShuttingDown returns false initially", () => {
    expect(isShuttingDown()).toBe(false);
  });

  it("initiateShutdown closes the server and exits with 0", () => {
    const server = createServer();
    const closeSpy = vi.spyOn(server, "close").mockImplementation(function (cb) {
      if (cb) (cb as () => void)();
      return server;
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    initiateShutdown(server, "SIGTERM");

    expect(isShuttingDown()).toBe(true);
    expect(closeSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);

    server.close();
  });

  it("ignores duplicate shutdown calls", () => {
    const server = createServer();
    let closeCallCount = 0;
    vi.spyOn(server, "close").mockImplementation(function (cb) {
      closeCallCount++;
      if (cb) (cb as () => void)();
      return server;
    });
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    initiateShutdown(server, "SIGTERM");
    initiateShutdown(server, "SIGINT"); // second call should be ignored

    expect(closeCallCount).toBe(1);

    server.close();
  });

  it("isShuttingDown returns true after shutdown initiated", () => {
    const server = createServer();
    vi.spyOn(server, "close").mockImplementation(function (cb) {
      if (cb) (cb as () => void)();
      return server;
    });
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    expect(isShuttingDown()).toBe(false);
    initiateShutdown(server, "SIGTERM");
    expect(isShuttingDown()).toBe(true);

    server.close();
  });
});
