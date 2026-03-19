import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createSession,
  getSession,
  deleteSession,
  listSessions,
  cleanupExpired,
  resetSessions,
  getSimulatorHandle,
  setSimulatorHandle,
} from "../../backend/src/simulator/session-manager.js";
import type { SimulatorHandle } from "../../backend/src/simulator/types.js";

function mustCreateSession(...args: Parameters<typeof createSession>) {
  const session = createSession(...args);
  if (!session) throw new Error("Expected session to be created");
  return session;
}

function makeFakeHandle(): SimulatorHandle & { cleanupCalls: number } {
  const handle = {
    cleanupCalls: 0,
    callPure: vi.fn(),
    callImpure: vi.fn(),
    getPublicState: vi.fn(() => ({})),
    getPrivateState: vi.fn(() => null),
    getCircuits: vi.fn(() => ({ pure: [], impure: [] })),
    setCaller: vi.fn(),
    resetCaller: vi.fn(),
    cleanup: vi.fn(() => {
      handle.cleanupCalls++;
      return Promise.resolve();
    }),
  };
  return handle;
}

describe("session-manager", () => {
  beforeEach(() => {
    resetSessions();
  });

  afterEach(() => {
    resetSessions();
  });

  it("creates a session with a unique ID and expiry", () => {
    const session = mustCreateSession("code1", [], {});
    expect(session.id).toHaveLength(36); // UUID format
    expect(session.code).toBe("code1");
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it("retrieves a session by ID", () => {
    const session = mustCreateSession("code2", [], {});
    const retrieved = getSession(session.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.code).toBe("code2");
  });

  it("returns undefined for unknown session ID", () => {
    expect(getSession("nonexistent")).toBeUndefined();
  });

  it("deletes a session", () => {
    const session = mustCreateSession("code3", [], {});
    deleteSession(session.id);
    expect(getSession(session.id)).toBeUndefined();
  });

  it("does not return expired sessions", () => {
    vi.useFakeTimers();
    const session = mustCreateSession("code4", [], {});
    vi.advanceTimersByTime(16 * 60 * 1000);
    expect(getSession(session.id)).toBeUndefined();
    vi.useRealTimers();
  });

  it("cleanupExpired removes expired sessions", () => {
    vi.useFakeTimers();
    createSession("code5", [], {});
    createSession("code6", [], {});
    vi.advanceTimersByTime(16 * 60 * 1000);
    const removed = cleanupExpired();
    expect(removed).toBe(2);
    expect(listSessions()).toHaveLength(0);
    vi.useRealTimers();
  });

  it("listSessions returns only active sessions", () => {
    createSession("a", [], {});
    createSession("b", [], {});
    expect(listSessions()).toHaveLength(2);
  });

  it("stores and retrieves a simulator handle", () => {
    const session = mustCreateSession("code-handle", [], {});
    const handle = makeFakeHandle();
    setSimulatorHandle(session.id, handle);
    expect(getSimulatorHandle(session.id)).toBe(handle);
  });

  it("cleans up simulator handle when session is deleted", () => {
    const session = mustCreateSession("code-del", [], {});
    const handle = makeFakeHandle();
    setSimulatorHandle(session.id, handle);
    deleteSession(session.id);
    expect(handle.cleanupCalls).toBe(1);
    expect(getSimulatorHandle(session.id)).toBeUndefined();
  });

  it("cleans up simulator handles on resetSessions", () => {
    const s1 = mustCreateSession("r1", [], {});
    const s2 = mustCreateSession("r2", [], {});
    const h1 = makeFakeHandle();
    const h2 = makeFakeHandle();
    setSimulatorHandle(s1.id, h1);
    setSimulatorHandle(s2.id, h2);
    resetSessions();
    expect(h1.cleanupCalls).toBe(1);
    expect(h2.cleanupCalls).toBe(1);
    expect(getSimulatorHandle(s1.id)).toBeUndefined();
    expect(getSimulatorHandle(s2.id)).toBeUndefined();
  });

  it("cleans up simulator handle when session expires", () => {
    vi.useFakeTimers();
    const session = mustCreateSession("code-expire", [], {});
    const handle = makeFakeHandle();
    setSimulatorHandle(session.id, handle);
    vi.advanceTimersByTime(16 * 60 * 1000);
    expect(getSession(session.id)).toBeUndefined();
    expect(handle.cleanupCalls).toBe(1);
    expect(getSimulatorHandle(session.id)).toBeUndefined();
    vi.useRealTimers();
  });
});
