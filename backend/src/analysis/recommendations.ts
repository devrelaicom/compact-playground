// backend/src/analysis/recommendations.ts
import type { Finding, Recommendation } from "./types.js";

const RECOMMENDATION_MESSAGES: Partial<Record<string, string>> = {
  "missing-stdlib-import":
    "Add 'import CompactStandardLibrary;' to access standard library functions",
  "unused-witness": "Remove unused witness declarations to keep the contract clean",
  "private-field-in-public-circuit":
    "Use disclose() when referencing private state in public circuits, or export the field",
  "public-circuit-unguarded-mutation":
    "Add authorization checks (assert) before modifying ledger state in public circuits",
  "deprecated-ledger-block":
    "Replace deprecated 'ledger { }' block with individual 'export ledger field: Type;' declarations",
  "invalid-void-type": "Replace 'Void' return type with '[]' (empty tuple)",
  "invalid-pragma-format":
    "Use bounded pragma format without patch version: 'pragma language_version >= 0.16 && <= 0.18;'",
  "unexported-enum": "Export enum types to make them accessible from TypeScript",
  "deprecated-cell-wrapper":
    "Remove Cell<T> wrapper — use the inner type directly (deprecated since 0.15)",
  "module-level-const": "Replace module-level const with a pure circuit that returns the value",
  "stdlib-name-collision": "Rename declarations that conflict with CompactStandardLibrary exports",
  "sealed-export-conflict":
    "Initialize sealed fields in a constructor block, not in exported circuits",
  "missing-constructor": "Add a constructor block to initialize sealed fields",
  "unsupported-division": "Use a witness to compute division off-chain and verify on-chain",
  "invalid-counter-access": "Use Counter.read() instead of .value()",
  "potential-overflow": "Cast to Field before multiplication to avoid Uint overflow",
  "undisclosed-witness-conditional": "Wrap witness comparisons in disclose() for conditional use",
  "undisclosed-constructor-param": "Wrap constructor parameter assignments in disclose()",
  "invalid-if-expression": "Use ternary operator instead of if-expression in assignments",
  "stdlib-type-mismatch": "Handle Either return types correctly (use .left or .right)",
};

export function buildRecommendations(findings: Finding[]): Recommendation[] {
  if (findings.length === 0) return [];

  // Group by code, deduplicate
  const byCode = new Map<string, Finding[]>();
  for (const f of findings) {
    const existing = byCode.get(f.code);
    if (existing) existing.push(f);
    else byCode.set(f.code, [f]);
  }

  const recommendations: Recommendation[] = [];
  for (const [code, group] of byCode) {
    const maxSeverity = group.some((f) => f.severity === "error")
      ? "high"
      : group.some((f) => f.severity === "warning")
        ? "medium"
        : "low";

    const knownMessage = RECOMMENDATION_MESSAGES[code];
    const message = knownMessage !== undefined ? knownMessage : (group[0]?.suggestion ?? "");
    recommendations.push({
      message,
      priority: maxSeverity,
      relatedFindings: [code],
    });
  }

  // Sort: high first, then medium, then low
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recommendations;
}
