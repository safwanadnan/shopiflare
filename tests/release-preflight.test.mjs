import assert from "node:assert/strict";
import { globSync } from "node:fs";
import { basename } from "node:path";
import { test } from "node:test";
import { checkLiveRelease } from "../scripts/check-live-release.mjs";

const applied = globSync("migrations/*.sql").map(file => ({ name: basename(file) }));
const config = { name: "fixture-worker", secrets: { required: ["SHOPIFY_API_SECRET"] } };
const database = { binding: "DB", migrations_dir: "migrations" };

function runCheck({ ledgerExists = true, entries = applied, secrets = [{ name: "SHOPIFY_API_SECRET" }] } = {}) {
  checkLiveRelease("production", "wrangler.jsonc", config, database, (args) => {
    assert.deepEqual(args.slice(args.indexOf("--config"), args.indexOf("--config") + 4),
      ["--config", "wrangler.jsonc", "--env", "production"]);
    if (args[0] === "secret") {
      assert.deepEqual(args, ["secret", "list", "--config", "wrangler.jsonc", "--env", "production", "--format", "json"]);
      return secrets;
    }
    assert.deepEqual(args.slice(0, 4), ["d1", "execute", "DB", "--remote"]);
    const query = args.at(-1);
    if (query === "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'd1_migrations'") {
      return [{ success: true, results: ledgerExists ? [{ name: "d1_migrations" }] : [] }];
    }
    assert.equal(query, 'SELECT name FROM "d1_migrations"');
    assert.equal(ledgerExists, true, "the check must not initialize a missing ledger");
    return [{ success: true, results: entries }];
  });
}

test("live preflight reads only the selected target's migration ledger and secret names", () => {
  assert.doesNotThrow(() => runCheck());
  assert.throws(() => runCheck({ ledgerExists: false }), /Pending D1 migrations.*0001_init\.sql/);
  assert.throws(() => runCheck({ entries: applied.slice(0, -1) }), /Pending D1 migrations/);
  assert.throws(() => runCheck({ secrets: [] }), /Missing required Worker secrets.*SHOPIFY_API_SECRET/);
  assert.throws(() => runCheck({ secrets: { unexpected: true } }), /did not return.*secret names/);
});
