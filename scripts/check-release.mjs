import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { checkLiveRelease } from "./check-live-release.mjs";

const configFile = "wrangler.jsonc";
const [environment, ...flags] = process.argv.slice(2);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJsonc(path) {
  const errors = [];
  const config = parseJsonc(readFileSync(path, "utf8"), errors, { allowTrailingComma: true });
  assert(config && !errors.length, `Invalid JSON configuration: ${path}`);
  return config;
}

const scopes = (value = "") => value.split(",").map(scope => scope.trim()).filter(Boolean).sort().join(",");
const d1 = config => config?.d1_databases?.find(binding => binding.binding === "DB");
const validId = id => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id ?? "");
const configured = value => typeof value === "string" && value.trim() && !/[<>]/.test(value);

try {
  assert(["development", "production"].includes(environment), "Choose development or production.");
  assert(flags.every(flag => ["--built", "--live"].includes(flag)) && new Set(flags).size === flags.length,
    "Use only the optional --built and --live flags.");
  const root = readJsonc(configFile);
  const config = root.env?.[environment];
  const other = root.env?.[environment === "development" ? "production" : "development"];
  const shopifyFile = environment === "development" ? "shopify.app.development.toml" : "shopify.app.toml";
  const app = parseToml(readFileSync(shopifyFile, "utf8"));
  const database = d1(config);
  const vars = config?.vars;

  assert(configured(config?.name) && config.name !== other?.name, "Use distinct Worker names for the two release environments.");
  assert(validId(database?.database_id) && configured(database.database_name), "Set the target D1 database name and UUID.");
  assert(database.database_id.toLowerCase() !== d1(other)?.database_id?.toLowerCase() &&
    database.database_name !== d1(other)?.database_name, "Development and production must use separate D1 databases.");
  assert(database.migrations_dir === "migrations", "The DB binding must point to the migrations directory.");
  assert(configured(app.client_id) && vars?.SHOPIFY_API_KEY === app.client_id &&
    app.client_id !== other?.vars?.SHOPIFY_API_KEY, "Match the target Shopify client ID in Wrangler and TOML; use separate Shopify apps.");
  assert(configured(app.application_url) && vars.SHOPIFY_APP_URL === app.application_url &&
    app.application_url !== other?.vars?.SHOPIFY_APP_URL, "Match the target app URL in Wrangler and TOML; use distinct URLs.");
  const url = new URL(app.application_url);
  assert(url.protocol === "https:" && url.origin === app.application_url, "Use an HTTPS app origin without a trailing slash.");
  assert(app.auth?.redirect_urls?.includes(`${url.origin}/auth/callback`) &&
    app.auth.redirect_urls.every(redirect => new URL(redirect).origin === url.origin),
    "Use the target app origin for Shopify callback URLs and include /auth/callback.");
  assert(typeof vars.SCOPES === "string" && typeof app.access_scopes?.scopes === "string" &&
    scopes(vars.SCOPES) === scopes(app.access_scopes.scopes), "Shopify scopes must match between Wrangler and TOML.");
  assert(vars.ENVIRONMENT === environment, "Set ENVIRONMENT to the selected release target.");
  const requiredSecrets = config.secrets?.required;
  assert(Array.isArray(requiredSecrets) && requiredSecrets.includes("SHOPIFY_API_SECRET") &&
    requiredSecrets.every(name => typeof name === "string" && !(name in vars)),
    "Declare SHOPIFY_API_SECRET as a required secret and keep it out of plain variables.");
  assert(config.version_metadata?.binding === "VERSION_METADATA", "Configure the Worker version metadata binding.");

  if (flags.includes("--built")) {
    // Wrangler follows this Vite-generated pointer on deploy. Validate what it will upload.
    const pointerFile = ".wrangler/deploy/config.json";
    const pointer = readJsonc(pointerFile);
    assert(typeof pointer.configPath === "string", "Missing Vite deploy config path. Rebuild the target.");
    const built = readJsonc(resolve(dirname(pointerFile), pointer.configPath));
    assert(built.name === config.name &&
      built.account_id === (config.account_id ?? root.account_id) &&
      built.vars?.ENVIRONMENT === environment &&
      built.vars?.SHOPIFY_APP_URL === vars.SHOPIFY_APP_URL &&
      built.vars?.SHOPIFY_API_KEY === vars.SHOPIFY_API_KEY &&
      scopes(built.vars?.SCOPES) === scopes(vars.SCOPES) &&
      d1(built)?.database_id === database.database_id &&
      JSON.stringify(built.secrets?.required?.slice().sort()) === JSON.stringify(requiredSecrets.slice().sort()),
      "Built Worker differs from the selected account, app, database, or required secrets. Rebuild the selected environment.");
  }

  if (flags.includes("--live")) checkLiveRelease(environment, configFile, config, database);
  console.log(`Release configuration passed: ${environment}${flags.length ? ` (${flags.map(flag => flag.slice(2)).join(", ")})` : ""}`);
} catch (error) {
  console.error(`Release configuration check failed: ${error.message}`);
  process.exitCode = 1;
}
