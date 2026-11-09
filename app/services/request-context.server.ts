import { AsyncLocalStorage } from "node:async_hooks";

export const requestContext = new AsyncLocalStorage<{
  requestId: string;
  environment: string;
  version?: string;
  execution: ExecutionContext;
  afterAuthSyncScheduled?: boolean;
}>();
