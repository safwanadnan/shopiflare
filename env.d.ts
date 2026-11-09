/// <reference types="vite/client" />
/// <reference types="@react-router/node" />

import "react-router";

declare module "react-router" {
  interface AppLoadContext {
    cloudflare: { env: Env; ctx: ExecutionContext };
  }
}
