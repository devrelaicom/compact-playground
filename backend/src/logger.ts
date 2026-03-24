import { configure, getConsoleSink, getLogger } from "@logtape/logtape";

/**
 * Initialize the LogTape logging pipeline.
 * Call once at startup before any log calls.
 */
export async function setupLogging(): Promise<void> {
  await configure({
    sinks: {
      console: getConsoleSink({
        formatter: ({ level, category, message, properties }) => {
          const ts = new Date().toISOString();
          const cat = category.join(".");
          const props = Object.keys(properties).length > 0 ? ` ${JSON.stringify(properties)}` : "";
          return `${ts} [${level.toUpperCase()}] ${cat}: ${message.join("")}${props}`;
        },
      }),
    },
    filters: {},
    loggers: [
      {
        category: ["compact-playground"],
        sinks: ["console"],
        lowestLevel: "info",
      },
    ],
  });
}

/** Application-level logger */
export const log = getLogger(["compact-playground"]);

/** Route-level logger */
export const routeLog = getLogger(["compact-playground", "routes"]);

/** Startup logger */
export const startupLog = getLogger(["compact-playground", "startup"]);

/**
 * Safely serialize an error for logging without exposing user content.
 * Extracts only the error message and class name — never the stack or cause chain,
 * which might contain code snippets from compiler output.
 */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.constructor.name}: ${error.message}`;
  }
  return "Unknown error";
}
