import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const buildHome = path.join(root, ".generated", "build-home");
const localAppData = path.join(buildHome, "AppData", "Local");
fs.mkdirSync(localAppData, { recursive: true });

const tmpDir = path.join(root, "tmp");
fs.mkdirSync(tmpDir, { recursive: true });

// Next's standalone file tracer evaluates home-directory paths used by the
// optional local CLI integrations. Keep tracing inside the project so Windows
// compatibility junctions in AppData are never traversed during a build.
const result = spawnSync(
  process.execPath,
  [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build", "--webpack"],
  {
    cwd: root,
    env: {
      ...process.env,
      HOME: buildHome,
      USERPROFILE: buildHome,
      LOCALAPPDATA: localAppData,
      TMPDIR: tmpDir,
      TEMP: tmpDir,
      TMP: tmpDir
    },
    stdio: "inherit"
  }
);

process.exit(result.status ?? 1);
