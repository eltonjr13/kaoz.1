const assert = require('node:assert/strict');
const test = require('node:test');
const { createFrameParser, validRuntime } = require('../electron/flow-native-host.cjs');
const { FLOW_EXTENSION_ID, FLOW_NATIVE_HOST_NAME } = require('../electron/flow-native-constants.cjs');
const { registerFlowNativeHost } = require('../electron/flow-native-registration.cjs');

function frame(value) {
  const payload = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  return Buffer.concat([header, payload]);
}

test('native host validates the rotating loopback descriptor', () => {
  assert.equal(validRuntime({ baseUrl: 'http://127.0.0.1:3210', token: 'a'.repeat(64), pid: 42 }), true);
  assert.equal(validRuntime({ baseUrl: 'http://localhost:3210', token: 'a'.repeat(64), pid: 42 }), false);
  assert.equal(validRuntime({ baseUrl: 'https://127.0.0.1:3210', token: 'a'.repeat(64), pid: 42 }), false);
  assert.equal(validRuntime({ baseUrl: 'http://127.0.0.1:3210', token: 'short', pid: 42 }), false);
});

test('native host parses split and consecutive Chrome frames', () => {
  const received = [];
  const parse = createFrameParser(value => received.push(value));
  const first = frame({ type: 'ping' });
  const second = frame({ type: 'ready', extensionId: FLOW_EXTENSION_ID });
  parse(first.subarray(0, 3));
  parse(Buffer.concat([first.subarray(3), second]));
  assert.deepEqual(received, [{ type: 'ping' }, { type: 'ready', extensionId: FLOW_EXTENSION_ID }]);
});

test('development shell never mutates the Chrome native-host registry', () => {
  assert.equal(FLOW_NATIVE_HOST_NAME, 'com.kaoz1.flow_companion');
  assert.deepEqual(registerFlowNativeHost({ userDataPath: '.', executablePath: process.execPath, packaged: false }), {
    registered: false,
    reason: 'development-build',
  });
});
