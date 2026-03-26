import { createServer } from "node:net";
import { describe, it, expect, afterAll } from "vitest";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { getClientIp } from "../../backend/src/rate-limit.js";
import { resetConfig } from "../../backend/src/config.js";

async function canBindLoopbackPort(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();

    probe.once("error", () => {
      resolve(false);
    });

    probe.listen(0, "127.0.0.1", () => {
      probe.close(() => {
        resolve(true);
      });
    });
  });
}

/**
 * Adapter-level integration test for runtime IP extraction.
 * Starts a real @hono/node-server to verify that c.env.incoming.socket.remoteAddress
 * is populated by the adapter when no trust flags are set.
 */
describe("Runtime IP via @hono/node-server adapter", () => {
  let server: ReturnType<typeof serve> | undefined;

  afterAll(() => {
    server?.close();
    delete process.env.TRUST_PROXY;
    delete process.env.TRUST_CLOUDFLARE;
    resetConfig();
  });

  it("extracts loopback IP from adapter when no trust flags are set", async ({ skip }) => {
    if (!(await canBindLoopbackPort())) {
      skip();
    }

    // Ensure no trust flags — getClientIp should fall through to runtime IP
    delete process.env.TRUST_PROXY;
    delete process.env.TRUST_CLOUDFLARE;
    resetConfig();

    let capturedIp = "";

    const app = new Hono();
    app.get("/ip-test", (c) => {
      capturedIp = getClientIp(c);
      return c.json({ ip: capturedIp });
    });

    // Use port 0 to let the OS assign a free port
    const port = await new Promise<number>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0 }, (info) => {
        const addr = info as { port: number };
        resolve(addr.port);
      });
    });

    const res = await fetch(`http://127.0.0.1:${String(port)}/ip-test`);
    const body = (await res.json()) as { ip: string };

    // When connecting via 127.0.0.1, the adapter should provide the loopback address.
    // Node reports this as "::1" (IPv6) or "127.0.0.1" (IPv4) depending on OS/config.
    expect(capturedIp).not.toBe("unknown");
    expect(typeof capturedIp).toBe("string");
    expect(body.ip).toBe(capturedIp);

    // Should be a loopback address
    expect(
      capturedIp === "127.0.0.1" || capturedIp === "::1" || capturedIp.startsWith("::ffff:127."),
    ).toBe(true);
  });
});
