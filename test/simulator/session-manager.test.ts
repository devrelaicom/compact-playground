import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createSession,
  getSession,
  deleteSession,
  listSessions,
  cleanupExpired,
  resetSessions,
} from "../../backend/src/simulator/session-manager.js";

describe("session-manager", () => {
  beforeEach(() => {
    resetSessions();
  });

  afterEach(() => {
    resetSessions();
  });

  it("creates a session with a unique ID and expiry", () => {
    const session = createSession("code1", [], {});
    expect(session.id).toBeDefined();
    expect(session.id).toHaveLength(36); // UUID format
    expect(session.code).toBe("code1");
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it("retrieves a session by ID", () => {
    const session = createSession("code2", [], {});
    const retrieved = getSession(session.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.code).toBe("code2");
  });

  it("returns undefined for unknown session ID", () => {
    expect(getSession("nonexistent")).toBeUndefined();
  });

  it("deletes a session", () => {
    const session = createSession("code3", [], {});
    deleteSession(session.id);
    expect(getSession(session.id)).toBeUndefined();
  });

  it("does not return expired sessions", () => {
    vi.useFakeTimers();
    const session = createSession("code4", [], {});
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
});
