const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { FLOW_EXTENSION_ID, FLOW_NATIVE_HOST_NAME, FLOW_NATIVE_REGISTRY_KEY } = require('./flow-native-constants.cjs');

function registerFlowNativeHost({ userDataPath, executablePath, packaged }) {
  if (process.platform !== 'win32') return { registered: false, reason: 'unsupported-platform' };
  if (!packaged) return { registered: false, reason: 'development-build' };
  const directory = path.join(userDataPath, 'flow-companion');
  const manifestPath = path.join(directory, `${FLOW_NATIVE_HOST_NAME}.json`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify({
    name: FLOW_NATIVE_HOST_NAME,
    description: 'Ponte entre o Kaoz.1 Desktop e a extensão Kaoz Flow Companion',
    path: path.resolve(executablePath),
    type: 'stdio',
    allowed_origins: [`chrome-extension://${FLOW_EXTENSION_ID}/`],
  }, null, 2)}\n`, 'utf8');
  const result = spawnSync('reg.exe', ['ADD', FLOW_NATIVE_REGISTRY_KEY, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], {
    windowsHide: true,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Falha ao registrar a ponte do Chrome.').trim());
  return { registered: true, manifestPath };
}

module.exports = { registerFlowNativeHost };
