// backend/src/analysis/rules.ts
import type { SemanticModel, Finding } from "./types.js";
import { locationAt } from "./parser.js";

// Known CompactStandardLibrary exports that shouldn't be redefined
const STDLIB_EXPORTS = [
  "burnAddress",
  "ownPublicKey",
  "contractAddress",
  "default",
  "disclose",
  "assert",
  "pad",
  "unpad",
  "Counter",
  "Map",
  "Set",
  "MerkleTree",
  "Opaque",
  "Vector",
];

export function runRules(model: SemanticModel): Finding[] {
  const findings: Finding[] = [];
  const { source } = model;
  const { code, lineByIndex } = source;

  // ── Spec-mandated rules ──

  // missing-stdlib-import
  if (!model.hasStdLibImport && source.circuits.length > 0) {
    findings.push({
      code: "missing-stdlib-import",
      severity: "warning",
      message: "CompactStandardLibrary is not imported",
      suggestion: "Add 'import CompactStandardLibrary;' at the top of your contract",
    });
  }

  // unused-witness
  for (const name of model.unusedWitnesses) {
    const witness = source.witnesses.find((w) => w.name === name);
    findings.push({
      code: "unused-witness",
      severity: "warning",
      message: `Witness '${name}' is declared but never referenced`,
      suggestion: `Remove the unused witness declaration or reference it in a circuit`,
      location: witness?.location,
    });
  }

  // private-field-in-public-circuit
  for (const sc of model.circuits) {
    if (!sc.parsed.isExported) continue;
    const privateFields = source.ledger.filter((l) => !l.isExported);
    for (const field of privateFields) {
      if (sc.operations.readsLedger.includes(field.name) && !sc.operations.usesDisclose) {
        findings.push({
          code: "private-field-in-public-circuit",
          severity: "warning",
          message: `Private ledger field '${field.name}' referenced in exported circuit '${sc.parsed.name}' without disclose()`,
          suggestion: `Use disclose(${field.name}) to explicitly reveal private data, or make the field exported`,
          location: sc.parsed.location,
        });
      }
    }
  }

  // public-circuit-unguarded-mutation
  for (const sc of model.circuits) {
    if (!sc.parsed.isExported) continue;
    if (sc.operations.writesLedger.length > 0 && !sc.operations.usesAssert) {
      findings.push({
        code: "public-circuit-unguarded-mutation",
        severity: "warning",
        message: `Exported circuit '${sc.parsed.name}' mutates ledger state without any assertion guard`,
        suggestion: `Add an assert() to verify caller authorization before modifying state`,
        location: sc.parsed.location,
      });
    }
  }

  // ── MCP-ported checks (P0 critical) ──

  // deprecated-ledger-block
  const ledgerBlockPattern = /ledger\s*\{/g;
  let match;
  while ((match = ledgerBlockPattern.exec(code)) !== null) {
    findings.push({
      code: "deprecated-ledger-block",
      severity: "error",
      message: "Deprecated ledger block syntax 'ledger { }' causes parse error",
      suggestion: "Use individual declarations: 'export ledger fieldName: Type;'",
      location: locationAt(code, match.index, lineByIndex),
    });
  }

  // invalid-void-type
  const voidPattern = /circuit\s+\w+\s*\([^)]*\)\s*:\s*Void\b/g;
  while ((match = voidPattern.exec(code)) !== null) {
    findings.push({
      code: "invalid-void-type",
      severity: "error",
      message: "Invalid return type 'Void' — Void does not exist in Compact",
      suggestion: "Use '[]' (empty tuple) for circuits that return nothing: 'circuit fn(): []'",
      location: locationAt(code, match.index, lineByIndex),
    });
  }

  // invalid-pragma-format
  const oldPragmaPattern = /pragma\s+language_version\s*>=?\s*\d+\.\d+\.\d+/g;
  while ((match = oldPragmaPattern.exec(code)) !== null) {
    findings.push({
      code: "invalid-pragma-format",
      severity: "error",
      message: "Pragma includes patch version which may cause parse errors",
      suggestion: "Use bounded range format: 'pragma language_version >= 0.16 && <= 0.18;'",
      location: locationAt(code, match.index, lineByIndex),
    });
  }

  // unexported-enum
  const unexportedEnumPattern = /(?<!export\s+)enum\s+(\w+)\s*\{/g;
  while ((match = unexportedEnumPattern.exec(code)) !== null) {
    const before = code.substring(Math.max(0, match.index - 10), match.index);
    if (!before.includes("export")) {
      const enumName = match[1];
      findings.push({
        code: "unexported-enum",
        severity: "warning",
        message: `Enum '${enumName}' is not exported — won't be accessible from TypeScript`,
        suggestion: `Add 'export' keyword: 'export enum ${enumName} { ... }'`,
        location: locationAt(code, match.index, lineByIndex),
      });
    }
  }

  // deprecated-cell-wrapper
  const cellPattern = /Cell\s*<\s*\w+\s*>/g;
  while ((match = cellPattern.exec(code)) !== null) {
    findings.push({
      code: "deprecated-cell-wrapper",
      severity: "error",
      message: "'Cell<T>' wrapper is deprecated since Compact 0.15",
      suggestion: "Use the type directly: 'Field' instead of 'Cell<Field>'",
      location: locationAt(code, match.index, lineByIndex),
    });
  }

  // module-level-const
  const constPattern = /^const\s+(\w+)\s*:/gm;
  while ((match = constPattern.exec(code)) !== null) {
    const beforeConst = code.substring(0, match.index);
    const lastCircuitStart = Math.max(
      beforeConst.lastIndexOf("circuit "),
      beforeConst.lastIndexOf("constructor {"),
    );
    const lastCloseBrace = beforeConst.lastIndexOf("}");

    if (lastCircuitStart === -1 || lastCloseBrace > lastCircuitStart) {
      const constName = match[1];
      findings.push({
        code: "module-level-const",
        severity: "error",
        message: `Module-level 'const ${constName}' is not supported in Compact`,
        suggestion: `Use 'pure circuit ${constName}(): <type> { return <value>; }' instead`,
        location: locationAt(code, match.index, lineByIndex),
      });
    }
  }

  // stdlib-name-collision
  if (model.hasStdLibImport) {
    for (const circuit of source.circuits) {
      if (STDLIB_EXPORTS.includes(circuit.name)) {
        findings.push({
          code: "stdlib-name-collision",
          severity: "error",
          message: `Circuit '${circuit.name}' conflicts with CompactStandardLibrary.${circuit.name}()`,
          suggestion: "Rename to avoid ambiguity, or remove to use the standard library version",
          location: circuit.location,
        });
      }
    }
  }

  // sealed-export-conflict
  const sealedFields = source.ledger.filter((l) => l.isSealed);
  if (sealedFields.length > 0) {
    for (const sc of model.circuits) {
      if (!sc.parsed.isExported) continue;
      for (const field of sealedFields) {
        if (sc.operations.writesLedger.includes(field.name)) {
          findings.push({
            code: "sealed-export-conflict",
            severity: "error",
            message: `Exported circuit '${sc.parsed.name}' modifies sealed field '${field.name}'`,
            suggestion: "Move sealed field initialization to a 'constructor { }' block instead",
            location: sc.parsed.location,
          });
        }
      }
    }
  }

  // missing-constructor (sealed fields but no constructor)
  if (sealedFields.length > 0 && !source.constructor) {
    const initCircuit = source.circuits.find(
      (c) =>
        c.isExported && (c.name.toLowerCase().includes("init") || c.name.toLowerCase() === "setup"),
    );
    if (initCircuit) {
      findings.push({
        code: "missing-constructor",
        severity: "warning",
        message: `Contract has sealed fields but uses '${initCircuit.name}' instead of constructor`,
        suggestion:
          "Sealed fields must be initialized in 'constructor { }', not in exported circuits",
        location: initCircuit.location,
      });
    }
  }

  // unsupported-division
  const divisionPattern = /[^/]\/[^/*]/g;
  while ((match = divisionPattern.exec(code)) !== null) {
    const beforeDiv = code.substring(0, match.index);
    const lastLineStart = beforeDiv.lastIndexOf("\n") + 1;
    const lineContent = beforeDiv.substring(lastLineStart);
    if (lineContent.includes("//")) continue;

    findings.push({
      code: "unsupported-division",
      severity: "warning",
      message: "Division operator '/' is not in the documented Compact operators (+, -, *)",
      suggestion: "If you need division, compute it off-chain in a witness and verify on-chain",
      location: locationAt(code, match.index + 1, lineByIndex),
    });
    break; // Only report once
  }

  // invalid-counter-access
  const counterValuePattern = /(\w+)\.value\s*\(/g;
  while ((match = counterValuePattern.exec(code)) !== null) {
    const varName = match[1];
    const isCounter = source.ledger.some((l) => l.name === varName && l.type === "Counter");
    if (isCounter) {
      findings.push({
        code: "invalid-counter-access",
        severity: "error",
        message: `Counter '${varName}' does not have '.value()' — use '.read()' instead`,
        suggestion:
          "Counter ADT methods: increment(n), decrement(n), read(), lessThan(n), resetToDefault()",
        location: locationAt(code, match.index, lineByIndex),
      });
    }
  }

  // potential-overflow
  const multiplyPattern = /(\w+)\s*\*\s*(\w+)(?:\s*\+\s*\w+)?\s*(?:as\s+Uint|==)/g;
  while ((match = multiplyPattern.exec(code)) !== null) {
    const beforeMult = code.substring(Math.max(0, match.index - 200), match.index);
    const afterMult = code.substring(match.index, match.index + match[0].length + 50);
    if (afterMult.includes("as Field") || beforeMult.includes("as Field")) continue;
    if (/assert|==/.test(afterMult)) {
      const lhs = match[1];
      const rhs = match[2];
      findings.push({
        code: "potential-overflow",
        severity: "warning",
        message: `Multiplication '${lhs} * ${rhs}' may overflow Uint bounds`,
        suggestion: `Cast operands to Field for safe arithmetic: '(${lhs} as Field) * (${rhs} as Field)'`,
        location: locationAt(code, match.index, lineByIndex),
      });
      break;
    }
  }

  // undisclosed-witness-conditional
  const witnessNames = source.witnesses.map((w) => w.name);
  const ifPattern = /if\s*\(([^)]+)\)/g;
  while ((match = ifPattern.exec(code)) !== null) {
    const condition = match[1];
    for (const witnessName of witnessNames) {
      if (
        condition.includes(witnessName) &&
        !condition.includes(`disclose(${witnessName}`) &&
        !condition.includes("disclose(")
      ) {
        findings.push({
          code: "undisclosed-witness-conditional",
          severity: "warning",
          message: `Witness value '${witnessName}' used in conditional without disclose()`,
          suggestion: `Wrap witness comparisons in disclose(): 'if (disclose(${witnessName} == expected))'`,
          location: locationAt(code, match.index, lineByIndex),
        });
        break;
      }
    }
  }

  // undisclosed-constructor-param
  if (source.constructor && source.constructor.parameters.length > 0) {
    const constructorBody = source.constructor.body;
    for (const param of source.constructor.parameters) {
      const escaped = param.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const assignmentPattern = new RegExp(`(\\w+)\\s*=\\s*(?!disclose\\s*\\()${escaped}\\b`, "g");
      let assignMatch;
      while ((assignMatch = assignmentPattern.exec(constructorBody)) !== null) {
        const fieldName = assignMatch[1];
        if (source.ledger.some((l) => l.name === fieldName)) {
          findings.push({
            code: "undisclosed-constructor-param",
            severity: "error",
            message: `Constructor parameter '${param.name}' assigned to ledger field '${fieldName}' without disclose()`,
            suggestion: `Wrap in disclose(): '${fieldName} = disclose(${param.name});'`,
            location: source.constructor.location,
          });
        }
      }
    }
  }

  // invalid-if-expression
  const ifAssignmentPattern = /(?:const|let)\s+\w+\s*=\s*if\s*\(/g;
  while ((match = ifAssignmentPattern.exec(code)) !== null) {
    findings.push({
      code: "invalid-if-expression",
      severity: "error",
      message: "'if' cannot be used as an expression in assignments",
      suggestion:
        "Use ternary operator instead: 'const x = condition ? valueIfTrue : valueIfFalse;'",
      location: locationAt(code, match.index, lineByIndex),
    });
  }

  // stdlib-type-mismatch (burnAddress)
  if (model.hasStdLibImport) {
    const burnAddressUsages = code.matchAll(/burnAddress\s*\(\s*\)/g);
    for (const usage of burnAddressUsages) {
      const usageIdx = usage.index;
      const afterUsage = code.substring(
        usageIdx + usage[0].length,
        usageIdx + usage[0].length + 50,
      );
      const beforeUsage = code.substring(Math.max(0, usageIdx - 100), usageIdx);

      if (
        !afterUsage.startsWith(".left") &&
        !afterUsage.startsWith(".right") &&
        !afterUsage.startsWith(".is_left")
      ) {
        if (/\(\s*$/.test(beforeUsage) || /,\s*$/.test(beforeUsage)) {
          findings.push({
            code: "stdlib-type-mismatch",
            severity: "warning",
            message:
              "burnAddress() returns Either<ZswapCoinPublicKey, ContractAddress>, not ZswapCoinPublicKey",
            suggestion:
              "Use burnAddress().left for ZswapCoinPublicKey, or define 'pure circuit zeroKey(): ZswapCoinPublicKey { return default<ZswapCoinPublicKey>; }'",
            location: locationAt(code, usageIdx, lineByIndex),
          });
          break;
        }
      }
    }
  }

  return findings;
}
