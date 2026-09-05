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

function serializeError(err: any): Record<string, any> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(err.cause ? { cause: serializeError(err.cause) } : {}),
    };
  }
  if (typeof err === "object" && err !== null) {
    return err;
  }
  return { message: String(err) };
}

function buildLogEntry(
  baseContext: LogContext,
  message: string,
  data?: Record<string, any>,
): Record<string, any> {
  const merged: Record<string, any> = {
    message,
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
