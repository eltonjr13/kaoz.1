const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { FLOW_EXTENSION_ID, FLOW_NATIVE_HOST_NAME } = require('../electron/flow-native-constants.cjs');
const { nativeHostManifest, registerFlowNativeHost } = require('../electron/flow-native-registration.cjs');

test('native host manifest authorizes only the stable Kaoz extension', () => {
  assert.equal(FLOW_NATIVE_HOST_NAME, 'com.kaoz1.flow_companion');
  assert.deepEqual(nativeHostManifest('C:\\Kaoz.1\\kaoz-flow-native-host.exe'), {
    name: FLOW_NATIVE_HOST_NAME,
    description: 'Ponte entre o Kaoz.1 Desktop e a extensão Kaoz Flow Companion',
    path: 'C:\\Kaoz.1\\kaoz-flow-native-host.exe',
    type: 'stdio',
    allowed_origins: [`chrome-extension://${FLOW_EXTENSION_ID}/`],
  });
});

test('missing native executable never mutates the Chrome registry', () => {
  assert.deepEqual(registerFlowNativeHost({ userDataPath: '.', nativeHostPath: 'missing-native-host.exe' }), {
    registered: false,
    reason: 'native-host-missing',
  });
});

const nativeExecutable = path.resolve('build/runtime/flow-native-host/kaoz-flow-native-host.exe');
test('compiled native host sends the authenticated desktop descriptor to Chrome', { skip: !fs.existsSync(nativeExecutable) }, async (t) => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'kaoz-native-host-'));
  const runtimeDir = path.join(appData, 'Kaoz.1');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const runtime = { baseUrl: 'http://127.0.0.1:4321', token: 'b'.repeat(64), pid: process.pid, updatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(runtimeDir, 'flow-companion-runtime.json'), JSON.stringify(runtime));
  const child = spawn(nativeExecutable, [`chrome-extension://${FLOW_EXTENSION_ID}/`], {
    env: { ...process.env, APPDATA: appData },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  t.after(() => {
    child.stdin.end();
    if (!child.killed) child.kill();
    fs.rmSync(appData, { recursive: true, force: true });
  });
  const message = await new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error('A ponte nativa não respondeu.')), 5000);
    child.once('error', reject);
    child.stdout.on('data', chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 4) return;
      const length = buffered.readUInt32LE(0);
      if (buffered.length < length + 4) return;
      clearTimeout(timer);
      resolve(JSON.parse(buffered.subarray(4, length + 4).toString('utf8')));
    });
  });
  assert.deepEqual(message, { type: 'configure', baseUrl: runtime.baseUrl, token: runtime.token, desktopPid: runtime.pid });
});
