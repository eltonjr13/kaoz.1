const fs = require('node:fs');
const path = require('node:path');
const { FLOW_EXTENSION_ID } = require('./flow-native-constants.cjs');

function runtimePath() {
  return process.env.KAOZ1_FLOW_NATIVE_RUNTIME_FILE
    || path.join(process.env.APPDATA || process.cwd(), 'Kaoz.1', 'flow-companion-runtime.json');
}

function validRuntime(value) {
  try {
    const url = new URL(value.baseUrl);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && Boolean(url.port)
      && /^[a-f0-9]{64}$/.test(value.token) && Number.isInteger(value.pid);
  } catch { return false; }
}

function writeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

function createFrameParser(onMessage) {
  let buffer = Buffer.alloc(0);
  return chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length > 1024 * 1024) throw new Error('Mensagem nativa excedeu o limite permitido.');
      if (buffer.length < length + 4) return;
      const payload = buffer.subarray(4, length + 4);
      buffer = buffer.subarray(length + 4);
      onMessage(JSON.parse(payload.toString('utf8')));
    }
  };
}

function readRuntime() {
  try {
    const value = JSON.parse(fs.readFileSync(runtimePath(), 'utf8'));
    return validRuntime(value) ? value : null;
  } catch { return null; }
}

function runFlowNativeHost({ nativeOrigin }) {
  if (nativeOrigin !== `chrome-extension://${FLOW_EXTENSION_ID}/`) {
    process.exitCode = 1;
    return;
  }
  let lastConfiguration = null;
  const publishConfiguration = () => {
    const runtime = readRuntime();
    const serialized = runtime ? JSON.stringify(runtime) : '';
    if (serialized === lastConfiguration) return;
    lastConfiguration = serialized;
    writeMessage(runtime
      ? { type: 'configure', baseUrl: runtime.baseUrl, token: runtime.token, desktopPid: runtime.pid }
      : { type: 'unavailable', message: 'Abra o Kaoz.1 para conectar a extensão.' });
  };
  process.stdin.on('data', createFrameParser(message => {
    if (message?.type === 'ping') publishConfiguration();
  }));
  process.stdin.on('error', () => process.exit(1));
  process.stdin.on('end', () => process.exit(0));
  process.stdin.resume();
  publishConfiguration();
  const timer = setInterval(publishConfiguration, 1500);
  timer.unref();
}

module.exports = { createFrameParser, runFlowNativeHost, validRuntime, writeMessage };
