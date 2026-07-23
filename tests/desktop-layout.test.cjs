const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

test("desktop shell stays inside the viewport area below the titlebar", () => {
  const appShell = fs.readFileSync(
    path.join(projectRoot, "components", "layout", "app-shell.tsx"),
    "utf8",
  );
  const globalCss = fs.readFileSync(path.join(projectRoot, "app", "globals.css"), "utf8");

  assert.match(appShell, /mrchicken-app-shell h-full min-h-0 max-h-full/);
  assert.doesNotMatch(appShell, /mrchicken-app-shell[^\n]*min-h-screen/);
  assert.match(
    globalCss,
    /html\[data-mrchicken-desktop="true"\] \.mrchicken-app-shell\s*\{[^}]*height:\s*calc\(100dvh - var\(--mrchicken-titlebar-height\)\);[^}]*min-height:\s*0;[^}]*max-height:\s*calc\(100dvh - var\(--mrchicken-titlebar-height\)\);[^}]*\}/s,
  );
});
