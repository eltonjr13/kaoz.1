const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  normalizeDesktopPreferences,
  readDesktopPreferences,
  writeDesktopPreferences
} = require("../electron/desktop-preferences.cjs");

test("ativa fechar para a bandeja por padrão", () => {
  assert.deepEqual(normalizeDesktopPreferences(null), {
    closeToTray: true,
    trayNoticeShown: false
  });
});

test("ignora valores inválidos sem perder preferências válidas", () => {
  assert.deepEqual(normalizeDesktopPreferences({ closeToTray: false, trayNoticeShown: "sim" }), {
    closeToTray: false,
    trayNoticeShown: false
  });
});

test("persiste e recupera as preferências do desktop", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mrchicken-desktop-preferences-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "desktop-preferences.json");

  writeDesktopPreferences(filePath, { closeToTray: false, trayNoticeShown: true });

  assert.deepEqual(readDesktopPreferences(filePath), {
    closeToTray: false,
    trayNoticeShown: true
  });
});
