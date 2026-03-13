import { Hono } from "hono";
import { z } from "zod";
import { deployContract, callCircuit } from "../simulator/engine.js";
import { getSession, deleteSession } from "../simulator/session-manager.js";
import { checkRateLimit, getClientIp } from "../rate-limit.js";

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
  if (!result.success && result.error?.includes("Session")) {
    return c.json(result, 404);
  }
  return c.json(result, result.success ? 200 : 400);
});

simulateRoutes.get("/simulate/:sessionId/state", (c) => {
  const session = getSession(c.req.param("sessionId"));
  if (!session) {
    return c.json({ success: false, error: "Session not found or expired" }, 404);
  }
  return c.json({
    success: true,
    sessionId: session.id,
    ledgerState: session.ledgerState,
    circuits: session.circuits,
    callHistory: session.callHistory,
    expiresAt: new Date(session.expiresAt).toISOString(),
  });
});

simulateRoutes.delete("/simulate/:sessionId", (c) => {
  const deleted = deleteSession(c.req.param("sessionId"));
  if (!deleted) {
    return c.json({ success: false, error: "Session not found" }, 404);
  }
  return c.json({ success: true, message: "Session deleted" });
});

export { simulateRoutes };
