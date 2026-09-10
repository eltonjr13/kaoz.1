import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_UI_SOUND_PREFERENCES,
  normalizeUiSoundPreferences,
  UI_SOUND_SOURCES,
} from "../lib/ui-sounds.ts";

test("normalizes persisted UI sound preferences safely", () => {
  assert.deepEqual(normalizeUiSoundPreferences(null), DEFAULT_UI_SOUND_PREFERENCES);
  assert.deepEqual(normalizeUiSoundPreferences({ enabled: false, volume: 2, playInBackground: false }), {
    enabled: false,
    volume: 1,
    playInBackground: false,
  });
  assert.equal(normalizeUiSoundPreferences({ volume: -0.5 }).volume, 0);
  assert.equal(normalizeUiSoundPreferences({ volume: Number.NaN }).volume, 0.58);
});

test("maps every runtime sound to an intact Neural Corrompido asset", () => {
  const soundDirectory = path.join(process.cwd(), "public", "sounds", "neural-corrupted");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(soundDirectory, "manifest.json"), "utf8"),
  ) as { files: { name: string; sha256: string }[] };
  const manifestByName = new Map(manifest.files.map((file) => [file.name, file]));

  assert.equal(manifest.files.length, Object.keys(UI_SOUND_SOURCES).length);
  for (const source of Object.values(UI_SOUND_SOURCES)) {
    const name = path.basename(source);
    const filePath = path.join(soundDirectory, name);
    const contents = fs.readFileSync(filePath);
    assert.equal(contents.toString("ascii", 0, 4), "RIFF");
    assert.equal(contents.toString("ascii", 8, 12), "WAVE");
    assert.equal(createHash("sha256").update(contents).digest("hex"), manifestByName.get(name)?.sha256);
  }
});
