const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { FLOW_EXTENSION_ID, FLOW_NATIVE_HOST_NAME, FLOW_NATIVE_REGISTRY_KEY } = require('./flow-native-constants.cjs');

function nativeHostManifest(nativeHostPath) {
  return {
    name: FLOW_NATIVE_HOST_NAME,
    description: 'Ponte entre o Kaoz.1 Desktop e a extensão Kaoz Flow Companion',
    path: path.resolve(nativeHostPath),
    type: 'stdio',
    allowed_origins: [`chrome-extension://${FLOW_EXTENSION_ID}/`],
  };
}

function registerFlowNativeHost({ userDataPath, nativeHostPath }) {
  if (process.platform !== 'win32') return { registered: false, reason: 'unsupported-platform' };
  if (!fs.existsSync(nativeHostPath)) return { registered: false, reason: 'native-host-missing' };
  const directory = path.join(userDataPath, 'flow-companion');
  const manifestPath = path.join(directory, `${FLOW_NATIVE_HOST_NAME}.json`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(nativeHostManifest(nativeHostPath), null, 2)}\n`, 'utf8');
  const result = spawnSync('reg.exe', ['ADD', FLOW_NATIVE_REGISTRY_KEY, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], {
    windowsHide: true,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Falha ao registrar a ponte do Chrome.').trim());
  return { registered: true, manifestPath };
}

module.exports = { nativeHostManifest, registerFlowNativeHost };
