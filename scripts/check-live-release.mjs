import { execFileSync } from "node:child_process";
import { globSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

function wranglerJson(args, description) {
  let output;
  try {
    output = execFileSync(process.execPath, [wrangler, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
    });
  } catch {
    throw new Error(`Could not ${description}. Check Cloudflare access and that the target resource exists.`);
  }
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Could not read Wrangler's response while attempting to ${description}.`);
  }
}

export function checkLiveRelease(environment, configFile, config, database, run = wranglerJson) {
  const target = ["--config", configFile, "--env", environment];
  const table = database.migrations_table ?? "d1_migrations";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error("Use a simple SQL identifier for the D1 migrations table.");
  }

  const files = globSync(database.migrations_pattern ?? `${database.migrations_dir}/*.sql`, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(database.migrations_dir, `${entry.parentPath}/${entry.name}`).replaceAll("\\", "/"))
    .sort();
  if (!files.length || files.some(file => file.startsWith("../"))) {
    throw new Error("No valid SQL migrations found in the configured migrations directory.");
  }

  function select(sql) {
    const response = run(
      ["d1", "execute", database.binding, "--remote", ...target, "--json", "--command", sql],
      `read the ${environment} D1 migration ledger`,
    );
    if (!Array.isArray(response) || response.length !== 1 ||
      response[0].success !== true || !Array.isArray(response[0].results)) {
      throw new Error("Wrangler did not return a successful D1 query result.");
    }
    return response[0].results;
  }

  // Wrangler's migrations list can create the ledger. Use SELECT only.
  const exists = select(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name = '${table}'`);
  const applied = new Set(exists.length ? select(`SELECT name FROM "${table}"`).map(row => row.name) : []);
  const pending = files.filter(name => !applied.has(name));
  if (pending.length) {
    const script = environment === "production" ? "db:migrate:prod" : "db:migrate:dev";
    throw new Error(`Pending D1 migrations for ${environment}: ${pending.join(", ")}. Review and apply with npm run ${script}.`);
  }

  // Named env config resolves the exact script. Passing --name together with
  // --env would cause Wrangler to append an environment suffix to that name.
  const secrets = run(["secret", "list", ...target, "--format", "json"], `list secrets on Worker ${config.name}`);
  if (!Array.isArray(secrets) || secrets.some(secret => typeof secret?.name !== "string")) {
    throw new Error("Wrangler did not return the target Worker's secret names.");
  }
  const names = new Set(secrets.map(secret => secret.name));
  const missing = config.secrets.required.filter(name => !names.has(name));
  if (missing.length) {
    throw new Error(`Missing required Worker secrets for ${environment}: ${missing.join(", ")}.`);
  }
}
