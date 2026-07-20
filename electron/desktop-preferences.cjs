const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_DESKTOP_PREFERENCES = Object.freeze({
  closeToTray: true,
  trayNoticeShown: false
});

function normalizeDesktopPreferences(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    closeToTray: typeof source.closeToTray === "boolean" ? source.closeToTray : DEFAULT_DESKTOP_PREFERENCES.closeToTray,
    trayNoticeShown: typeof source.trayNoticeShown === "boolean" ? source.trayNoticeShown : DEFAULT_DESKTOP_PREFERENCES.trayNoticeShown
  };
}

function readDesktopPreferences(filePath) {
  try {
    return normalizeDesktopPreferences(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return { ...DEFAULT_DESKTOP_PREFERENCES };
  }
}

function writeDesktopPreferences(filePath, preferences) {
  const normalized = normalizeDesktopPreferences(preferences);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

function shouldHideWindowOnClose({ isQuitting, installingUpdate, closeToTray }) {
  return Boolean(closeToTray && !isQuitting && !installingUpdate);
}

module.exports = {
  DEFAULT_DESKTOP_PREFERENCES,
  normalizeDesktopPreferences,
  readDesktopPreferences,
  shouldHideWindowOnClose,
  writeDesktopPreferences
};
