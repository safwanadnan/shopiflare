import { requestContext } from "./request-context.server";

export interface LogContext {
  shopId?: string | number | null;
  shopDomain?: string | null;
  [key: string]: any;
}

export interface Logger {
  info: (message: string, data?: Record<string, any>) => void;
  log: (message: string, data?: Record<string, any>) => void;
  warn: (message: string, data?: Record<string, any>) => void;
  error: (message: string, data?: Record<string, any>) => void;
  withContext: (childContext: LogContext) => Logger;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { name: "UnknownError" };
  return {
    name: error.name,
    // Exclude the error message (first line), which may contain credentials or payload data.
    stack: error.stack?.split("\n").filter(line => /^\s+at /.test(line)).join("\n"),
  };
}

function buildLogEntry(
  baseContext: LogContext,
  message: string,
  data?: Record<string, any>,
): Record<string, any> {
  const context = requestContext.getStore();
  const merged: Record<string, any> = {
    message,
    requestId: context?.requestId,
    environment: context?.environment,
    version: context?.version,
    shopId: data?.shopId ?? baseContext.shopId ?? null,
    shopDomain: data?.shopDomain ?? baseContext.shopDomain ?? null,
    ...baseContext,
    ...data,
  };

  // Serialize errors cleanly
  if (merged.error) {
    merged.error = serializeError(merged.error);
  }

  return merged;
}

export function createLogger(baseContext: LogContext = {}): Logger {
  return {
    info(message: string, data?: Record<string, any>) {
      console.log(buildLogEntry(baseContext, message, data));
    },
    log(message: string, data?: Record<string, any>) {
      console.log(buildLogEntry(baseContext, message, data));
    },
    warn(message: string, data?: Record<string, any>) {
      console.warn(buildLogEntry(baseContext, message, data));
    },
    error(message: string, data?: Record<string, any>) {
      console.error(buildLogEntry(baseContext, message, data));
    },
    withContext(childContext: LogContext) {
      return createLogger({
        ...baseContext,
        ...childContext,
      });
    },
  };
}

export const logger = createLogger();
