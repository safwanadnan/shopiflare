# Shopiflare

Shopiflare is a starter for embedded Shopify apps using React Router, Shopify App Bridge and Polaris, Cloudflare Workers, and Drizzle on D1. Fork it, give the fork its own Shopify apps and Cloudflare resources, and deploy from the fork. This template has placeholder IDs and URLs. Its GitHub workflow runs checks and dry runs only.

## Run locally

Use Node 22.18+ or 24 and npm. Install the [Shopify CLI](https://shopify.dev/docs/api/shopify-cli) when you need to preview or release Shopify app configuration. Wrangler is installed with the project.

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev:cf
```

Set the Shopify development app's client ID and secret in `.dev.vars`. The app runs at `http://localhost:3000` by default and uses emulated D1 data under `.wrangler/state`. Open `/health/live` to check that the Worker responds and `/health` to check the app configuration and schema.

For embedded auth and real webhook testing, use a development store and an HTTPS tunnel. Set `SHOPIFY_APP_URL` to the tunnel's origin in `.dev.vars` **and** pass that origin in the shell when starting `npm run dev:cf` so Vite accepts the tunnel host. Set the same app URL and `/auth/callback` origin in the Shopify development preview. Use [Shopify CLI's custom tunnel option](https://shopify.dev/docs/api/shopify-cli/app/app-dev#flags-propertydetail-tunnel-url) if the CLI manages the preview. Keep production credentials out of local files.

## Set up a fork

| Target | Worker | D1 | Shopify config |
| --- | --- | --- | --- |
| Local | Vite Workers runtime | Emulated `DB` | Development preview |
| Development | `env.development` | Development database | `shopify.app.development.toml` |
| Production | `env.production` | Production database | `shopify.app.toml` |

1. Create separate Shopify apps for development and production. Replace the names, handles, client IDs, app URLs, and redirect URLs in both TOML files. Start with the minimum access scopes; the demo needs `write_products`.
2. Choose distinct Worker names and HTTPS origins. Set the corresponding `SHOPIFY_APP_URL`, `SHOPIFY_API_KEY` (the client ID), and `SCOPES` in each named environment in `wrangler.jsonc`. For custom domains, configure the matching Cloudflare route and disable `workers_dev` if it isn't needed. Keep preview URLs off unless the app explicitly supports them.
3. Create two D1 databases with `npx wrangler d1 create <database-name>`. Copy each name and UUID into its environment's `DB` binding. The top-level binding is for local emulation; use the development database's name and ID there. Keep the two remote databases separate.
4. Set each app's client secret on its own Worker. Wrangler prompts for the value; for a new Worker, follow the prompt to create it or set the secret in the Cloudflare dashboard.

   ```sh
   npx wrangler secret put SHOPIFY_API_SECRET --config wrangler.jsonc --env development
   npx wrangler secret put SHOPIFY_API_SECRET --config wrangler.jsonc --env production
   ```

   Keep secrets out of version control, plain Wrangler vars, and build output. Rotate them deliberately and separately from routine releases.

## Change the database

Edit `app/db/schema.ts`, run `npm run db:generate -- --name describe_change`, and review the generated SQL and metadata before committing them. The checked-in Drizzle snapshot matches `0001_init.sql`; new generated migrations use timestamped names. Keep earlier migrations intact once applied. Write migrations for triggers or data backfills as separate SQL files and give them a name that sorts after the last applied migration.

Apply and test changes locally with `npm run db:migrate:local`. Use `npm run db:migrate:dev` or `npm run db:migrate:prod` only for the intended remote database. Prefer additive changes so the old Worker can still run while you apply the schema and if you need to roll back the code.

## Release a configured fork

Run `npm run check` to regenerate Worker and React Router types, check TypeScript, and run the infrastructure tests. For local bundle verification:

```sh
npm run build:dev
npx wrangler deploy --dry-run --outdir /tmp/shopiflare-dry-run
```

Use `build:prod` for the production target. Each build rewrites Vite's Wrangler config pointer, so run the dry run immediately after the intended build.

1. Run `npm run preflight:dev` and check the target database and migration list. Apply required development migrations, then run `npm run deploy:dev`. The script checks the source config, runs the checks, builds the named environment, and verifies the **built** Worker name, Shopify app, and database before upload.
2. Run `npm run deploy:shopify:dev` when scopes, URLs, webhooks, or extensions change. Shopify configuration releases are separate from Worker uploads.
3. Verify `/health` reports HTTP 200 and the expected Worker version, open the app from Shopify admin, and smoke test app navigation and a webhook on a development store. Check that embedded pages and data responses return `Cache-Control: private, no-store`.
4. Promote the same reviewed revision with `npm run preflight:prod`, the required production migrations, and `npm run deploy:prod`. Run `npm run deploy:shopify:prod` only when the Shopify configuration changed. Record the new and previous Worker version IDs. A Worker rollback does not roll back D1 migrations or a Shopify app version.

## Conventions inherited from production apps

- **Merchant data and auth:** Authenticate each loader or action that reads merchant data or calls Shopify. Keep Shopify's document and boundary headers on direct loads and redirects. Embedded admin and auth routes are private and never enter the shared edge cache.
- **Offline sessions:** Enable Shopify's [expiring offline tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens), store refresh metadata with the session, and keep tokens out of shop profiles and logs. The adapter skips legacy sessions without a valid expiry, and D1 rejects new non-expiring offline credentials. An expired access token is distinct from a non-expiring token; it may still be renewable. A delayed SDK invalidation can clear only the token it loaded. Before migrating an existing app, plan how to replace or reauthorize legacy grants. Apps with concurrent background Shopify calls should coordinate exchange, refresh, and uninstall per shop and fence stale writes and delayed uninstall events against the active installation.
- **Webhooks:** [Verify the signature over the raw body](https://shopify.dev/docs/apps/build/webhooks/subscribe/https) before parsing it. The verifier bounds the body and checks the route's allowed topics. Webhook ingestion does not fetch or refresh a Shopify access token. Acknowledge durable work after the database write or queue handoff succeeds. Use a stable delivery or event ID for retries and handle out-of-order delivery where it can change state.
- **Privacy:** Compliance webhooks record one intake row per shop, topic, and event, even if the Shop row is gone. Intake alone does not fulfill Shopify's [privacy requirements](https://shopify.dev/docs/apps/build/privacy-law-compliance). Implement export, deletion, and retention policies in the fork before review. Do not copy raw payloads into logs.
- **Operations:** Worker logs carry a request ID, environment, and version where available. Keep automatic invocation logs off unless needed for diagnosis. Use `/health/live` for cheap liveness and `/health` for readiness; neither calls Shopify or returns secret values.
- **Background work:** Use `waitUntil` for best-effort work such as profile and subscription reconciliation after auth. For work that must survive a retry or Worker interruption, add a durable job or outbox and a Queue with a dead-letter queue. Make consumers idempotent and bound attempts, batch size, and cron work. Add Hyperdrive for external Postgres and service bindings for internal Worker calls when a fork needs them.

The sample subscription service shows Admin API billing operations. For a new public app, check [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing) before adopting manual billing.
