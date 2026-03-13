import { z } from "zod";

export const compileBodySchema = z.object({
  code: z.string().min(1, "Code is required"),
  options: z
    .object({
      wrapWithDefaults: z.boolean().optional(),
      languageVersion: z.string().optional(),
      skipZk: z.boolean().optional(),
      timeout: z.number().positive().optional(),
      version: z.string().optional(),
      includeBindings: z.boolean().optional(),
      libraries: z.array(z.string().max(100)).max(20).optional(),
    })
    .optional()
    .default({}),
  versions: z.array(z.string()).optional(),
});

export const formatBodySchema = z.object({
  code: z.string().min(1, "Code is required"),
  options: z
    .object({
      timeout: z.number().positive().optional(),
      version: z.string().optional(),
    })
    .optional()
    .default({}),
  versions: z.array(z.string()).optional(),
});

export const analyzeBodySchema = z.object({
  code: z.string().min(1, "Code is required"),
  mode: z.enum(["fast", "deep"]).optional().default("fast"),
  versions: z.array(z.string()).optional(),
  include: z
    .array(
      z.enum(["diagnostics", "facts", "findings", "recommendations", "circuits", "compilation"]),
    )
    .optional(),
  circuit: z.string().optional(),
});

export const diffBodySchema = z.object({
  before: z.string().min(1, "'before' code is required"),
  after: z.string().min(1, "'after' code is required"),
});

export const visualizeBodySchema = z.object({
  code: z.string().min(1, "Code is required"),
});
