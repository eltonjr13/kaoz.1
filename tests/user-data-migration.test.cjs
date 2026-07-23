const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { MIGRATION_MARKER, migrateLegacyUserData } = require("../electron/user-data-migration.cjs");

test("migra dados da identidade anterior sem apagar ou sobrescrever arquivos", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kaoz1-user-data-migration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const legacyRoot = path.join(root, "legacy");
  const currentRoot = path.join(root, "current");
  fs.mkdirSync(path.join(legacyRoot, "generated"), { recursive: true });
  fs.mkdirSync(currentRoot, { recursive: true });
  fs.writeFileSync(path.join(legacyRoot, "generated", "memory.json"), "legacy", "utf8");
  fs.writeFileSync(path.join(legacyRoot, "desktop-preferences.json"), "legacy-settings", "utf8");
  fs.writeFileSync(path.join(currentRoot, "desktop-preferences.json"), "current-settings", "utf8");

  assert.equal(migrateLegacyUserData({ currentRoot, legacyRoot }), true);
  assert.equal(fs.readFileSync(path.join(currentRoot, "generated", "memory.json"), "utf8"), "legacy");
  assert.equal(fs.readFileSync(path.join(currentRoot, "desktop-preferences.json"), "utf8"), "current-settings");
  assert.equal(fs.existsSync(path.join(currentRoot, MIGRATION_MARKER)), true);

  fs.writeFileSync(path.join(legacyRoot, "generated", "memory.json"), "changed", "utf8");
  assert.equal(migrateLegacyUserData({ currentRoot, legacyRoot }), false);
  assert.equal(fs.readFileSync(path.join(currentRoot, "generated", "memory.json"), "utf8"), "legacy");
});
