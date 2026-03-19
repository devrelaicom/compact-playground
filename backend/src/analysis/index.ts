// backend/src/analysis/index.ts
import { parseSource } from "./parser.js";
import { buildSemanticModel } from "./semantic-model.js";
import { runRules } from "./rules.js";
import { buildRecommendations } from "./recommendations.js";
import { buildExplanations } from "./explanations.js";
import { compile } from "../compiler.js";
import { runMultiVersion } from "../middleware.js";
import { getFileCache, generateCacheKey } from "../cache.js";
import type {
  AnalysisResponse,
  AnalysisSummary,
  AnalysisStructure,
  CircuitAnalysis,
  AnalyzeOptions,
  CompilerDiagnostic,
  Finding,
} from "./types.js";

export type { AnalysisResponse, AnalyzeOptions };

function buildSummary(source: ReturnType<typeof parseSource>): AnalysisSummary {
  const exportedLedger = source.ledger.filter((l) => l.isExported);
  const privateLedger = source.ledger.filter((l) => !l.isExported);

  return {
    hasLedger: source.ledger.length > 0,
    hasCircuits: source.circuits.length > 0,
    hasWitnesses: source.witnesses.length > 0,
    totalLines: source.lines.length,
    publicCircuits: source.circuits.filter((c) => c.isExported).length,
    privateCircuits: source.circuits.filter((c) => !c.isExported).length,
    publicState: exportedLedger.length,
    privateState: privateLedger.length,
  };
}

function buildStructure(source: ReturnType<typeof parseSource>): AnalysisStructure {
  return {
    imports: source.imports,
    exports: source.exports,
    ledger: source.ledger.map((l) => ({
      name: l.name,
      type: l.type,
      isPrivate: !l.isExported,
      location: l.location,
    })),
    circuits: source.circuits.map((c) => ({
      name: c.name,
      isPublic: c.isExported,
      isPure: c.isPure,
      parameters: c.parameters,
      returnType: c.returnType,
      location: c.location,
    })),
    witnesses: source.witnesses.map((w) => ({
      name: w.name,
      parameters: w.parameters,
      returnType: w.returnType,
      location: w.location,
    })),
    types: [
      ...source.types.map((t) => ({
        name: t.name,
        definition: t.definition,
        location: t.location,
      })),
      ...source.structs.map((s) => ({
        name: s.name,
        definition: `struct { ${s.fields.join(", ")} }`,
        location: s.location,
      })),
      ...source.enums.map((e) => ({
        name: e.name,
        definition: `enum { ${e.variants.join(", ")} }`,
        location: e.location,
      })),
    ],
  };
}

function buildCircuitAnalyses(
  model: ReturnType<typeof buildSemanticModel>,
  allFindings: Finding[],
  circuitFilter?: string,
): CircuitAnalysis[] {
  const explanations = buildExplanations(model);
  let circuits = model.circuits;

  if (circuitFilter) {
    circuits = circuits.filter((c) => c.parsed.name === circuitFilter);
  }

  return circuits.map((sc) => {
    const explanation = explanations.find((e) => e.circuitName === sc.parsed.name);
    const circuitFindings = allFindings.filter(
      (f) => f.location && f.location.line === sc.parsed.location.line,
    );

    return {
      name: sc.parsed.name,
      structure: {
        isPublic: sc.parsed.isExported,
        isPure: sc.parsed.isPure,
        parameters: sc.parsed.parameters,
        returnType: sc.parsed.returnType,
        location: sc.parsed.location,
      },
      explanation: explanation ?? {
        circuitName: sc.parsed.name,
        isPublic: sc.parsed.isExported,
        isPure: sc.parsed.isPure,
        parameters: sc.parsed.parameters,
        returnType: sc.parsed.returnType,
        explanation: "",
        operations: [],
        zkImplications: [],
        privacyConsiderations: [],
      },
      facts: {
        readsPrivateState: sc.operations.readsLedger.some(
          (name) => model.source.ledger.find((l) => l.name === name && !l.isExported) !== undefined,
        ),
        revealsPrivateData: sc.operations.usesDisclose,
        commitsData: sc.operations.usesCommit,
        hashesData: sc.operations.usesHash,
        constrainsExecution: sc.operations.usesAssert,
        mutatesLedger: sc.operations.writesLedger.length > 0,
        ledgerMutations: sc.operations.writesLedger,
      },
      findings: circuitFindings,
    };
  });
}

export async function analyzeContract(
  code: string,
  options: AnalyzeOptions,
): Promise<{ result: AnalysisResponse; cacheKey?: string }> {
  // Only cache fast-mode analysis (deep mode depends on compile results and versions)
  const cache = options.mode === "fast" ? getFileCache() : null;
  const cacheKey = cache ? generateCacheKey(code, "none", { mode: options.mode }) : null;

  if (cache && cacheKey) {
    const cached = await cache.get<AnalysisResponse>("analyze", cacheKey);
    if (cached) {
      // Apply post-processing filters on cached result
      return { result: applyFilters(cached, options), cacheKey };
    }
  }

  // Stage 1: Parse
  const parsed = parseSource(code);

  // Stage 2: Build semantic model
  const model = buildSemanticModel(parsed);

  // Stage 3: Run rules
  const findings = runRules(model);

  // Stage 4: Build recommendations
  const recommendations = buildRecommendations(findings);

  // Stage 5: Build circuit analyses (with explanations) — no filter here, applied post-cache
  const circuitAnalyses = buildCircuitAnalyses(model, findings);

  // Build response
  const response: AnalysisResponse = {
    success: true,
    mode: options.mode,
    diagnostics: parsed.diagnostics,
    summary: buildSummary(parsed),
    structure: buildStructure(parsed),
    facts: {
      hasStdLibImport: model.hasStdLibImport,
      unusedWitnesses: model.unusedWitnesses,
    },
    findings,
    recommendations,
    circuits: circuitAnalyses,
  };

  // Deep mode: add compilations
  if (options.mode === "deep") {
    const mapDiagnostics = (
      errors: Array<{
        severity: "error" | "warning" | "info";
        message: string;
        line?: number;
        column?: number;
        file?: string;
      }>,
    ): CompilerDiagnostic[] =>
      errors.map((e) => ({
        severity: e.severity,
        message: e.message,
        line: e.line,
        column: e.column,
        file: e.file,
      }));

    if (options.versions && options.versions.length > 0) {
      const mvResults = await runMultiVersion(options.versions, code, async (version) => {
        const { result } = await compile(code, { wrapWithDefaults: true, skipZk: true, version });
        return {
          success: result.success,
          compilerVersion: result.compilerVersion,
          diagnostics: mapDiagnostics(result.errors ?? []),
          executionTime: result.executionTime,
        };
      });

      response.compilations = mvResults.map((c) => ({
        success: c.success,
        compilerVersion: c.compilerVersion,
        requestedVersion: c.requestedVersion,
        diagnostics: c.diagnostics,
        executionTime: c.executionTime,
      }));
    } else {
      const { result: compileResult } = await compile(code, {
        wrapWithDefaults: true,
        skipZk: true,
      });
      response.compilations = [
        {
          success: compileResult.success,
          compilerVersion: compileResult.compilerVersion,
          requestedVersion: "default",
          diagnostics: mapDiagnostics(compileResult.errors ?? []),
          executionTime: compileResult.executionTime,
        },
      ];
    }
  }

  // Cache the full unfiltered result for fast mode
  if (cache && cacheKey) {
    await cache.set("analyze", cacheKey, response);
  }

  // Apply post-processing filters
  return { result: applyFilters(response, options), cacheKey: cacheKey ?? undefined };
}

function applyFilters(response: AnalysisResponse, options: AnalyzeOptions): AnalysisResponse {
  // Apply circuit filter
  if (options.circuit) {
    response = {
      ...response,
      circuits: response.circuits.filter((c) => c.name === options.circuit),
    };
  }

  // Apply include[] filtering (omit sections not requested)
  // summary and structure are always returned
  if (options.include && options.include.length > 0) {
    response = { ...response };
    const include = new Set(options.include);
    if (!include.has("diagnostics")) response.diagnostics = [];
    if (!include.has("facts")) {
      response.facts = { hasStdLibImport: response.facts.hasStdLibImport, unusedWitnesses: [] };
    }
    if (!include.has("findings")) response.findings = [];
    if (!include.has("recommendations")) response.recommendations = [];
    if (!include.has("circuits")) response.circuits = [];
    if (!include.has("compilation")) {
      delete response.compilations;
    }
  }

  return response;
}
