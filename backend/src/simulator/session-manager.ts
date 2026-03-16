import { randomUUID } from "crypto";
import type { SimulationSession, CircuitInfo, LedgerState } from "./types.js";

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_SESSIONS = 100;

const sessions = new Map<string, SimulationSession>();

// Periodic cleanup of expired sessions (every 5 minutes)
setInterval(
  () => {
    cleanupExpired();
  },
  5 * 60 * 1000,
).unref();

export function createSession(
  code: string,
  circuits: CircuitInfo[],
  initialLedger: LedgerState,
): SimulationSession | null {
  if (sessions.size >= MAX_SESSIONS) {
    cleanupExpired();
    if (sessions.size >= MAX_SESSIONS) return null;
  }
  const now = Date.now();
  const session: SimulationSession = {
    id: randomUUID(),
    code,
    circuits,
    ledgerState: { ...initialLedger },
    callHistory: [],
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): SimulationSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  if (Date.now() > session.expiresAt) {
    sessions.delete(id);
    return undefined;
  }
  // Refresh TTL on access (inactivity-based expiry)
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

export function deleteSession(id: string): boolean {
  return sessions.delete(id);
}

export function listSessions(): SimulationSession[] {
  const now = Date.now();
  const active: SimulationSession[] = [];
  for (const [id, session] of sessions) {
    if (now > session.expiresAt) {
      sessions.delete(id);
    } else {
      active.push(session);
    }
  }
  return active;
}

export function cleanupExpired(): number {
  const now = Date.now();
  let removed = 0;
  for (const [id, session] of sessions) {
    if (now > session.expiresAt) {
      sessions.delete(id);
      removed++;
    }
  }
  return removed;
}

export function resetSessions(): void {
  sessions.clear();
}
