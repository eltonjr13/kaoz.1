import assert from "node:assert/strict";
import test from "node:test";
import { readFile, access } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("TypeScript lip-sync adapter exposes provider abstraction and MuseTalk implementation", async () => {
  const source = await read("lib/ai/lipsync.ts");
  assert.match(source, /export\s+interface\s+LipSyncProvider/);
  assert.match(source, /export\s+class\s+MuseTalkProvider/);
  assert.match(source, /generateTalkingAvatar\s*\(/);
  assert.match(source, /LIPSYNC_TRANSFER_MODE/);
  assert.match(source, /generate-upload/);
  assert.match(source, /videoUrl/);
  assert.match(source, /export\s+async\s+function\s+generateLipSync/);
});

test("legacy video lip-sync wrapper delegates to the AI lip-sync adapter", async () => {
  const source = await read("lib/videos/lip-sync.ts");
  assert.match(source, /@\/lib\/ai\/lipsync/);
  assert.match(source, /createLipSyncVideo/);
});

test("Python MuseTalk microservice exposes the requested REST contract", async () => {
  await access(path.join(root, "services/lipsync/app.py"));
  await access(path.join(root, "services/lipsync/musetalk_service.py"));
  await access(path.join(root, "services/lipsync/requirements.txt"));

  const app = await read("services/lipsync/app.py");
  const service = await read("services/lipsync/musetalk_service.py");

  assert.match(app, /@app\.post\(["']\/generate["']/);
  assert.match(app, /@app\.post\(["']\/generate-upload["']/);
  assert.match(app, /videoUrl/);
  assert.match(app, /jobId/);
  assert.match(app, /avatarPath/);
  assert.match(app, /audioPath/);
  assert.match(service, /class\s+MuseTalkService/);
  assert.match(service, /GPU|cuda|CUDA/i);
});
