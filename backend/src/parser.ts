/**
 * Parser for Compact compiler error output
 */

export interface CompilerError {
  line?: number;
  column?: number;
  message: string;
  severity: "error" | "warning" | "info";
  file?: string;
}

/**
 * Parses compiler output into structured error objects
 *
 * Expected formats from the Compact compiler:
 * - "Exception: filename.compact line X char Y:\n  error message"
 * - "Error: message"
 * - "Warning: message"
 * - "parse error: found X looking for Y"
 */
export function parseCompilerErrors(output: string): CompilerError[] {
  if (!output || output.trim() === "") {
    return [];
  }

  const errors: CompilerError[] = [];
  const lines = output.split("\n");

  // Regex patterns for different error formats
  const exceptionPattern = /Exception:\s*(\S+)\s+line\s+(\d+)\s+char\s+(\d+):/i;
  const simpleErrorPattern = /^(Error|Warning|Info):\s*(.+)/i;
  const parseErrorPattern = /parse error:\s*(.+)/i;
  const typeErrorPattern = /expected\s+(.+)\s+to have type\s+(.+)\s+but received\s+(.+)/i;
  const unboundPattern = /unbound identifier\s*"([^"]+)"/i;

  let currentError: Partial<CompilerError> | null = null;
  let messageBuffer = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Check for Exception pattern (e.g., "Exception: contract.compact line 5 char 12:")
    const exceptionMatch = line.match(exceptionPattern);
    if (exceptionMatch) {
      // Save previous error if exists
      if (currentError && messageBuffer) {
        currentError.message = messageBuffer.trim();
        errors.push(currentError as CompilerError);
      }

      currentError = {
        file: exceptionMatch[1],
        line: parseInt(exceptionMatch[2], 10),
        column: parseInt(exceptionMatch[3], 10),
        severity: "error",
      };
      messageBuffer = "";
      continue;
    }

    // Check for simple error/warning pattern
    const simpleMatch = trimmedLine.match(simpleErrorPattern);
    if (simpleMatch && !currentError) {
      const severity = simpleMatch[1].toLowerCase() as "error" | "warning" | "info";
      errors.push({
        message: simpleMatch[2].trim(),
        severity,
      });
      continue;
    }

    // Accumulate message lines for current error
    if (currentError) {
      // Check for specific error patterns to enrich the message
      const parseMatch = trimmedLine.match(parseErrorPattern);
      const typeMatch = trimmedLine.match(typeErrorPattern);
      const unboundMatch = trimmedLine.match(unboundPattern);

      if (parseMatch || typeMatch || unboundMatch || trimmedLine) {
        if (messageBuffer) {
          messageBuffer += " ";
        }
        messageBuffer += trimmedLine;
      }
    } else if (trimmedLine && !trimmedLine.startsWith("Exception:")) {
      // Standalone error message without location info
      const parseMatch = trimmedLine.match(parseErrorPattern);
      if (parseMatch) {
        errors.push({
          message: parseMatch[1],
          severity: "error",
        });
      } else if (trimmedLine.includes("error") || trimmedLine.includes("Error")) {
        errors.push({
          message: trimmedLine,
          severity: "error",
        });
      } else if (trimmedLine.includes("warning") || trimmedLine.includes("Warning")) {
        errors.push({
          message: trimmedLine,
          severity: "warning",
        });
      }
    }
  }

  // Don't forget the last error
  if (currentError && messageBuffer) {
    currentError.message = messageBuffer.trim();
    errors.push(currentError as CompilerError);
  }

  // Deduplicate errors
  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = `${String(error.line)}:${String(error.column)}:${error.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Formats errors for display
 */
export function formatErrors(errors: CompilerError[]): string {
  return errors
    .map((error) => {
      const prefix = error.severity === "warning" ? "Warning" : "Error";
      let location = "";

      if (error.line !== undefined) {
        location = ` at line ${String(error.line)}`;
        if (error.column !== undefined) {
          location += `, column ${String(error.column)}`;
        }
      }

      return `${prefix}${location}: ${error.message}`;
    })
    .join("\n");
}
