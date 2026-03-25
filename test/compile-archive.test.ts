import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { gzipSync } from "zlib";
import { pack as tarPack } from "tar-stream";

// --- Mocks (must be before imports of mocked modules) ---

vi.mock("../backend/src/archive-compiler.js", () => ({
  compileArchive: vi.fn(),
}));

vi.mock("../backend/src/rate-limit.js", () => ({
  checkArchiveRateLimit: vi.fn(() => true),
  getClientIp: vi.fn(() => "test-ip"),
}));

vi.mock("../backend/src/config.js", () => ({
  getConfig: vi.fn(() => ({
    defaultCompilerVersion: "latest",
    cacheEnabled: false,
  })),
  resetConfig: vi.fn(),
}));

vi.mock("../backend/src/cache.js", () => ({
  getFileCache: vi.fn(() => null),
  generateArchiveCacheKey: vi.fn(() => "mock-key"),
  resetFileCache: vi.fn(),
}));

import { compileArchive } from "../backend/src/archive-compiler.js";
import { checkArchiveRateLimit, getClientIp } from "../backend/src/rate-limit.js";
import { ArchiveValidationError } from "../backend/src/archive.js";
import { archiveCompileRoutes } from "../backend/src/routes/compile-archive.js";

const mockCompileArchive = compileArchive as ReturnType<typeof vi.fn>;
const mockCheckArchiveRateLimit = checkArchiveRateLimit as ReturnType<typeof vi.fn>;

// --- Helpers ---

/** Creates a valid .tar.gz buffer with the given files. */
function createTarGz(files: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pack = tarPack();
    const chunks: Buffer[] = [];

    for (const [name, content] of Object.entries(files)) {
      pack.entry({ name }, content);
    }
    pack.finalize();

    pack.on("data", (chunk: Buffer) => chunks.push(chunk));
    pack.on("end", () => {
      const tarBuffer = Buffer.concat(chunks);
      resolve(gzipSync(tarBuffer));
    });
    pack.on("error", reject);
  });
}

/** Builds a multipart FormData request body for the route. */
function buildFormData(
  archive: Buffer | null,
  entryPoint?: string,
  options?: Record<string, unknown>,
): FormData {
  const form = new FormData();
  if (archive) {
    form.append(
      "archive",
      new File([new Uint8Array(archive)], "project.tar.gz", { type: "application/gzip" }),
    );
  }
  if (entryPoint !== undefined) {
    form.append("entryPoint", entryPoint);
  }
  if (options !== undefined) {
    form.append("options", JSON.stringify(options));
  }
  return form;
}

function createApp() {
  const app = new Hono();
  app.route("/", archiveCompileRoutes);
  return app;
}

// --- Tests ---

describe("POST /compile/archive", () => {
  let app: Hono;

  beforeEach(() => {
    vi.resetAllMocks();
    mockCheckArchiveRateLimit.mockReturnValue(true);
    (getClientIp as ReturnType<typeof vi.fn>).mockReturnValue("test-ip");
    app = createApp();
  });

  // ---------- Request validation ----------

  describe("request validation", () => {
    it("missing archive → 400", async () => {
      const form = new FormData();
      form.append("entryPoint", "main.compact");

      const res = await app.request("/compile/archive", {
        method: "POST",
        body: form,
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.success).toBe(false);
      expect(body.message).toBe("archive file is required");
    });

    it("missing entryPoint → 400", async () => {
      const archive = await createTarGz({ "main.compact": "export circuit main(): [] {}" });
      const form = new FormData();
      form.append(
        "archive",
        new File([new Uint8Array(archive)], "project.tar.gz", { type: "application/gzip" }),
      );

      const res = await app.request("/compile/archive", {
        method: "POST",
        body: form,
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.success).toBe(false);
      expect(body.message).toBe("entryPoint field is required");
    });

    it("archive too large (>1MB) → 400", async () => {
      // Create a buffer that exceeds 1MB with gzip magic bytes
      const oversized = Buffer.alloc(1024 * 1024 + 1);
      oversized[0] = 0x1f;
      oversized[1] = 0x8b;

      const form = buildFormData(oversized, "main.compact");

      const res = await app.request("/compile/archive", {
        method: "POST",
        body: form,
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.success).toBe(false);
      // Body limit middleware may intercept before the handler's size check,
      // causing parseBody to fail. Either way the request is rejected with 400.
      expect(typeof body.message).toBe("string");
    });

    it("invalid format (not gzip) → 400", async () => {
      const notGzip = Buffer.from("this is not a gzip file");
      const form = buildFormData(notGzip, "main.compact");

      const res = await app.request("/compile/archive", {
        method: "POST",
        body: form,
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.success).toBe(false);
      expect(body.message).toBe("Invalid archive format. Expected a .tar.gz file");
    });
  });

  // ---------- Happy path ----------

  describe("happy path", () => {
    it("valid archive + entryPoint → calls compileArchive with correct args", async () => {
      const compileResult = {
        success: true,
        output: "Compilation successful",
        compiledAt: "2024-01-01T00:00:00Z",
        executionTime: 150,
        originalCode: "export circuit main(): [] {}",
      };
      mockCompileArchive.mockResolvedValue({ result: compileResult, cacheKey: "mock-key" });

      const archive = await createTarGz({ "main.compact": "export circuit main(): [] {}" });
      const form = buildFormData(archive, "main.compact");

      const res = await app.request("/compile/archive", {
        method: "POST",
        body: form,
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      const results = body.results as Record<string, unknown>[];
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].output).toBe("Compilation successful");
      expect(results[0].compiledAt).toBeDefined();
      expect(results[0].executionTime).toBeDefined();
      expect(results[0].originalCode).toBeDefined();
      expect(results[0].requestedVersion).toBe("detect");
      expect(body.cacheKey).toBe("mock-key");

      expect(mockCompileArchive).toHaveBeenCalledOnce();
      const [buf, entry, opts] = mockCompileArchive.mock.calls[0] as [Buffer, string, unknown];
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(entry).toBe("main.compact");
      expect(opts).toBeUndefined();
    });

    it("passes options through when provided", async () => {
      mockCompileArchive.mockResolvedValue({
        result: { success: true, output: "ok", compiledAt: "2024-01-01T00:00:00Z" },
      });

      const archive = await createTarGz({ "main.compact": "code" });
      const form = buildFormData(archive, "main.compact", { skipZk: true, timeout: 5000 });

      const res = await app.request("/compile/archive", {
        method: "POST",
        body: form,
      });

      expect(res.status).toBe(200);
      const [, , opts] = mockCompileArchive.mock.calls[0] as [
        Buffer,
        string,
        Record<string, unknown>,
      ];
      expect(opts).toEqual({ skipZk: true, timeout: 5000 });
    });
  });

  // ---------- ArchiveValidationError ----------

  describe("ArchiveValidationError handling", () => {
    it("compileArchive throws ArchiveValidationError → 400 with message", async () => {
      mockCompileArchive.mockRejectedValue(
        new ArchiveValidationError(
          "Archive contains unsupported entry type: symlinks are not allowed",
        ),
      );

      const archive = await createTarGz({ "main.compact": "code" });
      const form = buildFormData(archive, "main.compact");

      const res = await app.request("/compile/archive", {
        method: "POST",
        body: form,
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.success).toBe(false);
      expect(body.error).toBe("Validation error");
      expect(body.message).toBe(
        "Archive contains unsupported entry type: symlinks are not allowed",
      );
    });
  });

  // ---------- Rate limiting ----------

  describe("rate limiting", () => {
    it("checkArchiveRateLimit returns false → 429", async () => {
      mockCheckArchiveRateLimit.mockReturnValue(false);

      const archive = await createTarGz({ "main.compact": "code" });
      const form = buildFormData(archive, "main.compact");

      const res = await app.request("/compile/archive", {
        method: "POST",
        body: form,
      });

      expect(res.status).toBe(429);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.success).toBe(false);
      expect(body.error).toBe("Rate limit exceeded");
    });
  });

  // ---------- Server errors ----------

  describe("server errors", () => {
    it("compileArchive throws generic Error → 500", async () => {
      mockCompileArchive.mockRejectedValue(new Error("Unexpected compiler crash"));

      const archive = await createTarGz({ "main.compact": "code" });
      const form = buildFormData(archive, "main.compact");

      const res = await app.request("/compile/archive", {
        method: "POST",
        body: form,
      });

      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.success).toBe(false);
      expect(body.error).toBe("Internal server error");
      expect(body.message).toBe("An unexpected error occurred during processing");
    });
  });

  // ---------- Options parsing ----------

  describe("options parsing", () => {
    it("invalid JSON options → 400", async () => {
      const archive = await createTarGz({ "main.compact": "code" });
      const form = new FormData();
      form.append(
        "archive",
        new File([new Uint8Array(archive)], "project.tar.gz", { type: "application/gzip" }),
      );
      form.append("entryPoint", "main.compact");
      form.append("options", "not valid json{{{");

      const res = await app.request("/compile/archive", {
        method: "POST",
        body: form,
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.success).toBe(false);
      expect(body.message).toBe("options must be valid JSON");
    });
  });
});
