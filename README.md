# Shopiflare ⚡

> **A production-ready, ultra-fast Shopify App Boilerplate running natively on Cloudflare Workers, Cloudflare D1 (Serverless SQLite), and Drizzle ORM.**

Shopiflare combines **React Router v7**, the official **`@shopify/shopify-app-react-router`** SDK, **Cloudflare Workers**, **Cloudflare D1**, and **Drizzle ORM** to deliver a blazing-fast, serverless Shopify application with zero WebAssembly engine overhead and true global edge latency.

---

## ⚡ Why Drizzle ORM on Cloudflare D1?

Traditional Prisma setups on Cloudflare Workers rely on a large WebAssembly (WASM) query engine file and synthetic filesystem shims, resulting in:
- High bundle sizes and memory footprint.
- Cold-start latency spikes due to WASM compilation.
- Vulnerabilities during offline access token renewal and datetime conversions.

**Shopiflare solves this by migrating to Drizzle ORM (`drizzle-orm/d1`):**
- **Zero WASM Overhead:** Pure TypeScript/JavaScript SQL query builder compiled directly for the Cloudflare V8 runtime.
- **Sub-10ms Edge Cold Starts:** Native Cloudflare D1 binding (`env.DB`) communicates directly with edge SQLite.
- **Strict Type Safety:** Relational queries and typed schema definitions with automatic migration generation via `drizzle-kit`.
- **Bulletproof Session Storage:** Full implementation of Shopify's `SessionStorage` interface supporting expiring offline access tokens and `refreshToken` rotation.

---

## 🏗️ Architecture & Project Structure

```
shopiflare/
├── app/
│   ├── db/
│   │   └── schema.ts               # Drizzle ORM SQLite schema (Session, Shop, Subscriptions, GDPR)
│   ├── routes/
│   │   ├── _index/                 # Public landing page with merchant login form
│   │   ├── app.tsx                 # Embedded Shopify admin layout with App Bridge navigation
│   │   ├── app._index.tsx          # Embedded app dashboard with Polaris Web Components
│   │   ├── app.additional.tsx      # Sub-page navigation example
│   │   ├── auth.$.tsx              # OAuth callback & background store profile enrichment
│   │   ├── auth.login/             # Merchant login route
│   │   └── webhooks.*              # Real-time Shopify Webhook handlers (GDPR, app, subscriptions, shop)
│   ├── services/
│   │   ├── logger.server.ts        # Centralized structured JSON logger with context bindings
│   │   ├── shop.server.ts          # GraphQL store enrichment (40+ fields) and upsert routines
│   │   └── subscription.server.ts  # Recurring billing GraphQL queries, plans & webhook sync
│   ├── db.server.ts                # D1 Drizzle database client initialization (env.DB)
│   ├── session-storage.server.ts   # Custom DrizzleSessionStorage with token refresh logic
│   └── shopify.server.ts           # Shopify API configuration, hooks & auth lifecycle
├── migrations/
│   └── 0001_init.sql               # Production-ready SQLite SQL migration for Cloudflare D1
├── workers/
│   └── app.ts                      # Cloudflare Worker entrypoint forwarding env and ExecutionContext
├── drizzle.config.ts               # Drizzle Kit configuration for migrations and schema inspection
├── shopify.app.dev.toml            # Shopify CLI configuration for Local Development
├── shopify.app.staging.toml        # Shopify CLI configuration for Staging
├── shopify.app.toml                # Shopify CLI configuration for Production
├── wrangler.jsonc                  # Cloudflare Worker, D1 & Observability config
└── vite.config.ts                  # Vite config with Cloudflare SSR plugin & zero-WASM bundling
```

---

## 🌐 Multi-Environment Topology

| Environment | Cloudflare Worker | D1 Database | Shopify App Config | Git Branch |
|---|---|---|---|---|
| **Local** | `wrangler dev` (via Vite Plugin) | Local D1 Emulation (`.wrangler/state`) | `shopify.app.development.toml` | Working Branch (`feature/*`) |
| **Development (Remote)** | `shopiflare-development` | `shopiflare-shopify-app-db-dev` | `shopify.app.development.toml` | `develop` / `main` |
| **Production** | `shopiflare` | `shopiflare-shopify-app-db-prod` | `shopify.app.toml` | `main` |

---

## 🚀 Getting Started

### 1. Prerequisites
Ensure you have the following installed on your development machine:
* **Node.js** (>= 20.19 or >= 22.12)
* **Shopify CLI**: `npm install -g @shopify/cli`
* **Cloudflare Wrangler**: `npm install -g wrangler`
* *(Optional)* **cloudflared**: For exposing your local port to Shopify OAuth (`cloudflared tunnel`).

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/safwanadnan/shopiflare.git
cd shopiflare
npm install
```

---

## 🗄️ Database Setup & Migrations with Drizzle

### 1. Create Cloudflare D1 Databases
If setting up new Cloudflare D1 databases for your app:
```bash
# Create Production Database
npx wrangler d1 create shopiflare-shopify-app-db-prod

# Create Development Database
npx wrangler d1 create shopiflare-shopify-app-db-dev
```
*Copy the generated `database_id` values into the corresponding blocks in [`wrangler.jsonc`](./wrangler.jsonc).*

### 2. Apply Initial Migrations
Shopiflare includes the initial SQL migration in `migrations/0001_init.sql`. Apply it to your target database:

```bash
# Apply to Local D1 database (used by local dev server)
npm run db:migrate:local

# Apply to Remote Development D1 database
npm run db:migrate:dev

# Apply to Remote Production D1 database
npm run db:migrate:prod
```

### 3. Modifying the Schema with Drizzle Kit
When you add or update models in `app/db/schema.ts`:
1. Generate a new SQL migration file automatically:
   ```bash
   npm run db:generate
   ```
   *Drizzle Kit will inspect `app/db/schema.ts` and create the next numbered SQL migration in `migrations/`.*
2. Apply the migration to your desired environment:
   ```bash
   npm run db:migrate:local  # Local
   npm run db:migrate:dev    # Remote Development
   npm run db:migrate:prod   # Remote Production
   ```

---

## 🔐 Environment Variables & Secrets

Cloudflare Workers distinguish between plain environment variables (`vars` in `wrangler.jsonc`) and encrypted secrets.

### Local Development (`.dev.vars`)
Create a `.dev.vars` file in the root directory (gitignored):
```env
SHOPIFY_API_KEY=your_dev_shopify_api_key
SHOPIFY_API_SECRET=your_dev_shopify_api_secret
SCOPES=write_products
```

### Staging & Production Secrets
Upload your Shopify API credentials as encrypted Cloudflare Worker secrets:

```bash
# Development Secrets
npx wrangler secret put SHOPIFY_API_KEY --env development
npx wrangler secret put SHOPIFY_API_SECRET --env development

# Production Secrets
npx wrangler secret put SHOPIFY_API_KEY --env production
npx wrangler secret put SHOPIFY_API_SECRET --env production
```

---

## 🔑 Session Storage & Expiring Access Tokens

Shopiflare implements modern Shopify security best practices with `expiringOfflineAccessTokens: true` in `app/shopify.server.ts`.

- When an offline token is issued by Shopify, it includes an expiry timestamp and a **90-day `refreshToken`**.
- In `app/session-storage.server.ts`, `DrizzleSessionStorage` stores `refreshToken` and `refreshTokenExpires` in Cloudflare D1.
- Upon session retrieval via `loadSession(id)`, the `refreshToken` is restored onto the Shopify `Session` instance.
- If the offline access token has reached its expiry, Shopify's SDK automatically exchanges the `refreshToken` for a fresh access token seamlessly in the background without merchant re-authentication or 500 errors.

---

## 🔄 Self-Healing & Throttled Subscription Syncing

1. **Self-Healing on Install / Initial Access**:
   Inside `app/routes/app.tsx`, `context.cloudflare.ctx.waitUntil` executes a background check:
   ```ts
   const shop = await db.query.shops.findFirst({
     where: eq(shops.shopifyDomain, session.shop),
     columns: { rawShopData: true },
   });
   if (!shop || !shop.rawShopData) {
     await enrichShopFromGraphql(admin, session.shop, db, {
       accessToken: session.accessToken,
       scope: session.scope,
     });
     await syncAppSubscriptionsFromGraphql(admin, session.shop, db);
   }
   ```
2. **Preventing Redundant Page Load Syncs**:
   The GraphQL subscription sync is guarded **inside** the `if (!shop || !shop.rawShopData)` check. Routine page loads and tab navigations will **never** trigger unnecessary GraphQL requests or spam worker logs.
3. **Real-time Webhook Synchronization**:
   When a merchant updates, cancels, or changes their billing plan, Shopify triggers the `app_subscriptions/update` webhook. Shopiflare automatically processes this in `app/routes/webhooks.app_subscriptions.update.tsx` and updates Cloudflare D1 in real-time.

---

## 💳 App Monetization & Billing

Shopiflare includes a production-ready billing service (`app/services/subscription.server.ts`):

- **Query Active Subscriptions**: Synchronizes current plans directly from Shopify GraphQL Admin into the `AppSubscription` D1 table.
- **Create Recurring Subscription**:
  ```ts
  import { createAppSubscription } from "~/services/subscription.server";

  const { confirmationUrl } = await createAppSubscription(admin, {
    name: "Pro Plan",
    price: 19.99,
    returnUrl: `${appUrl}/app`,
    trialDays: 7,
  });
  // Redirect merchant to confirmationUrl
  ```
- **Webhooks Handling**: Listens to `app_subscriptions/update` to automatically record subscription state changes (`ACTIVE`, `CANCELLED`, `FROZEN`, etc.) without polling.

---

## 🛡️ Mandatory GDPR Compliance Webhooks

Shopify requires all public apps to implement mandatory GDPR compliance endpoints before passing app store review:
- `webhooks.customers.data_request.tsx`
- `webhooks.customers.redact.tsx`
- `webhooks.shop.redact.tsx`

Shopiflare routes all compliance webhooks through `webhooks.compliance.tsx`, which validates HMAC signatures via `@shopify/shopify-app-react-router` and securely records requests in the `ShopifyGdprRequest` D1 table for audit compliance.

---

## 🪵 Centralized Structured Logging

Use the structured logger service across your server loaders, actions, and services:

```ts
import { logger } from "~/services/logger.server";

// Standard logging
logger.info("Fetched data successfully", { count: 10 });

// Contextual child logger (automatically binds shopId and shopDomain)
const shopLogger = logger.withContext({ shopId: "12345", shopDomain: "myshop.myshopify.com" });
shopLogger.info("Processing merchant workflow");
shopLogger.error("Failed to process order", { error: err });
```

---

## 💻 Local Development Workflow

Because the Cloudflare Workers Vite plugin simulates D1 and Worker bindings directly inside Vite, you can run the full app locally:

1. **Start the local Dev Server**:
   ```bash
   npm run dev:cf
   ```
   *Your server will start at `http://localhost:8787` with local D1 database emulation.*

2. **Start a Cloudflare Tunnel**:
   In a separate terminal, expose your local dev server:
   ```bash
   cloudflared tunnel --url http://localhost:8787
   ```
   *Copy the generated `https://*.trycloudflare.com` URL.*

3. **Update `shopify.app.dev.toml`**:
   Set `application_url` and `redirect_urls` to your tunnel URL.

4. **Link & Test in Shopify Partner Dashboard**:
   ```bash
   shopify app config use dev
   shopify app dev
   ```

---

## 🚢 Deployment & CI/CD

### Deploy Code to Cloudflare Workers

```bash
# Deploy to Development Worker
npm run deploy:dev

# Deploy to Production Worker
npm run deploy:prod
```

### Deploy App Configuration to Shopify
Whenever you modify scopes, app URLs, or webhook declarations in your TOML files, sync them with Shopify:

```bash
# Deploy Development Shopify App Config
npm run deploy:shopify:dev

# Deploy Production Shopify App Config
npm run deploy:shopify:prod
```

---

## 📋 Available Scripts

| Script | Description |
|---|---|
| `npm run dev:cf` | Starts the local React Router dev server with Cloudflare Workers emulation |
| `npm run build` | Builds the client and server bundles using Vite SSR (Zero-WASM) |
| `npm run deploy:dev` | Builds and deploys the worker to the **Development** Cloudflare environment |
| `npm run deploy:prod` | Builds and deploys the worker to the **Production** Cloudflare environment |
| `npm run db:generate` | Generates new SQL migrations from `app/db/schema.ts` using Drizzle Kit |
| `npm run db:migrate:local` | Applies SQL migrations to the local D1 database |
| `npm run db:migrate:dev` | Applies SQL migrations to remote development D1 database |
| `npm run db:migrate:prod` | Applies SQL migrations to remote production D1 database |
| `npm run deploy:shopify:dev` | Pushes development app scopes, webhooks, and URLs to Shopify |
| `npm run deploy:shopify:prod` | Pushes production app scopes, webhooks, and URLs to Shopify |
| `npm run typecheck` | Runs TypeScript typechecker and React Router typegen |

---

## 📄 License
MIT
