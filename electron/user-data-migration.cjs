const fs = require("node:fs");
const path = require("node:path");

const MIGRATION_MARKER = ".kaoz1-migration-complete";

function migrateLegacyUserData({ currentRoot, legacyRoot }) {
  const marker = path.join(currentRoot, MIGRATION_MARKER);
  if (currentRoot === legacyRoot || !fs.existsSync(legacyRoot) || fs.existsSync(marker)) return false;

  fs.mkdirSync(currentRoot, { recursive: true });
  fs.cpSync(legacyRoot, currentRoot, {
    recursive: true,
    force: false,
    errorOnExist: false
  });
  fs.writeFileSync(marker, `${new Date().toISOString()}\n`, "utf8");
  return true;
}

module.exports = {
  MIGRATION_MARKER,
  migrateLegacyUserData
};
