// test/analysis/recommendations.test.ts
import { describe, it, expect } from "vitest";
import { buildRecommendations } from "../../backend/src/analysis/recommendations.js";
import type { Finding } from "../../backend/src/analysis/types.js";

describe("buildRecommendations", () => {
  it("produces high-priority recommendation for error findings", () => {
    const findings: Finding[] = [
      { code: "deprecated-ledger-block", severity: "error", message: "bad", suggestion: "fix it" },
    ];
    const recs = buildRecommendations(findings);
    expect(recs).toHaveLength(1);
    expect(recs[0].priority).toBe("high");
    expect(recs[0].relatedFindings).toContain("deprecated-ledger-block");
  });

  it("produces medium-priority recommendation for warning findings", () => {
    const findings: Finding[] = [
      { code: "unused-witness", severity: "warning", message: "unused", suggestion: "remove it" },
    ];
    const recs = buildRecommendations(findings);
    expect(recs[0].priority).toBe("medium");
  });

  it("deduplicates recommendations for same code", () => {
    const findings: Finding[] = [
      { code: "unused-witness", severity: "warning", message: "w1 unused", suggestion: "remove" },
      { code: "unused-witness", severity: "warning", message: "w2 unused", suggestion: "remove" },
    ];
    const recs = buildRecommendations(findings);
    expect(recs).toHaveLength(1);
  });

  it("returns empty for no findings", () => {
    expect(buildRecommendations([])).toEqual([]);
  });
});
