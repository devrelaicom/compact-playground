import { Hono } from "hono";
import { z } from "zod";
import { deployContract, callCircuit } from "../simulator/engine.js";
import { getSession, deleteSession } from "../simulator/session-manager.js";
import { checkRateLimit, getClientIp } from "../rate-limit.js";
import type { SimulationResult } from "../simulator/types.js";

const simulateRoutes = new Hono();

const deploySchema = z.object({
  code: z.string().min(1, "Contract code is required"),
  caller: z.string().optional(),
});

const callSchema = z.object({
  circuit: z.string().min(1, "Circuit name is required"),
  parameters: z.record(z.string(), z.string()).optional(),
  caller: z.string().optional(),
});

simulateRoutes.post("/simulate/deploy", async (c) => {
  if (!checkRateLimit(getClientIp(c))) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  const parsed = deploySchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      { success: false, error: "Invalid request", message: parsed.error.issues[0].message },
      400,
    );
  }

  const result = await deployContract(parsed.data);
  if (!result.success && result.errors?.[0]?.errorCode === "CAPACITY_EXCEEDED") {
    return c.json(result, 503);
  }
  return c.json(result, result.success ? 200 : 400);
});

simulateRoutes.post("/simulate/:sessionId/call", async (c) => {
  if (!checkRateLimit(getClientIp(c))) {
    return c.json({ success: false, error: "Rate limit exceeded" }, 429);
  }

  const sessionId = c.req.param("sessionId");
  const parsed = callSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      { success: false, error: "Invalid request", message: parsed.error.issues[0].message },
      400,
    );
  }

  const result = await callCircuit(sessionId, parsed.data);
  if (!result.success && result.errors?.[0]?.errorCode === "SESSION_NOT_FOUND") {
    return c.json(result, 404);
  }
  return c.json(result, result.success ? 200 : 400);
});

simulateRoutes.get("/simulate/:sessionId/state", (c) => {
  const sessionId = c.req.param("sessionId");
  const session = getSession(sessionId);
  if (!session) {
    const result: SimulationResult = {
      success: false,
      sessionId,
      errors: [
        {
          message: "Session not found or expired",
          severity: "error",
          errorCode: "SESSION_NOT_FOUND",
        },
      ],
    };
    return c.json(result, 404);
  }
  const result: SimulationResult = {
    success: true,
    sessionId: session.id,
    ledgerState: session.ledgerState,
    circuits: session.circuits,
    callHistory: session.callHistory,
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
  return c.json(result);
});

simulateRoutes.delete("/simulate/:sessionId", (c) => {
  const sessionId = c.req.param("sessionId");
  const deleted = deleteSession(sessionId);
  if (!deleted) {
    const result: SimulationResult = {
      success: false,
      sessionId,
      errors: [{ message: "Session not found", severity: "error", errorCode: "SESSION_NOT_FOUND" }],
    };
    return c.json(result, 404);
  }
  return c.json({ success: true, sessionId });
});

export { simulateRoutes };
