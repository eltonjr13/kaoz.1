import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { allowedSender, allowedImage, validPrompt, appOrigin } from '../extensions/flow-companion/protocol.mjs';

const manifest = JSON.parse(fs.readFileSync(path.resolve('extensions/flow-companion/manifest.json'), 'utf8'));

test('desktop bridge uses a stable extension id and Native Messaging permission', () => {
  assert.equal(manifest.version, '0.4.0');
  assert.equal(manifest.minimum_chrome_version, '105');
  assert.ok(manifest.permissions.includes('nativeMessaging'));
  assert.ok(manifest.host_permissions.includes('http://127.0.0.1/*'));
  const digest = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16);
  const extensionId = [...digest].map(byte => String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 15))).join('');
  assert.equal(extensionId, 'eogpaadohpepjiedfbmigenebifdlldi');
  const constants = fs.readFileSync(path.resolve('electron/flow-native-constants.cjs'), 'utf8');
  assert.match(constants, new RegExp(extensionId));
  const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  assert.ok(packageJson.build.extraResources.some(entry => entry.from === 'extensions/flow-companion' && entry.to === 'flow-companion-extension'));
  assert.ok(packageJson.build.extraResources.some(entry => entry.from === 'build/runtime/flow-native-host' && entry.to === 'flow-native-host'));
  assert.match(fs.readFileSync(path.resolve('build/installer.nsh'), 'utf8'), /DeleteRegKey HKCU .*com\.kaoz1\.flow_companion/);
});

test('only the approved Kaoz origin and Flow pages can command the extension', () => {
  assert.equal(allowedSender({ url: 'http://localhost:3000/flow/images' }), true);
  assert.equal(allowedSender({ url: 'https://kaoz.example/flow/images' }), false);
  assert.equal(allowedSender({ url: 'https://kaoz.example/flow/images' }, ['https://kaoz.example']), true);
  assert.equal(allowedSender({ url: 'http://localhost:3000/sketch' }), true);
  assert.equal(allowedSender({ url: 'https://kaoz.example/sketch/project' }, ['https://kaoz.example']), true);
  for (const url of ['https://evil.test', 'http://localhost:3001/flow/images', 'http://localhost:3000/other', 'http://localhost.evil.test:3000/flow/images', 'invalid']) assert.equal(allowedSender({ url }), false);
  assert.equal(allowedSender({}), false);
});
test('prompts and image origins are bounded, including original Flow CDN', () => {
  assert.equal(validPrompt('A white astronaut chicken'), true);
  for (const prompt of ['', '  ', null, {}, 'x'.repeat(16001)]) assert.equal(validPrompt(prompt), false);
  assert.equal(allowedImage('https://flow-content.google/image/123'), true);
  assert.equal(allowedImage('https://lh3.googleusercontent.com/image'), true);
  for (const url of ['http://flow-content.google/image/123', 'https://flow-content.google.evil.test/image', 'https://evil.test/image', 'https://user:password@labs.google/image', 'data:image/png;base64,eA==']) assert.equal(allowedImage(url), false);
  assert.equal(appOrigin('https://kaoz.example/flow'), 'https://kaoz.example');
  assert.throws(() => appOrigin('http://kaoz.example'), /HTTPS/);
});
test('worker resumes an existing request after restart and rejects another origin', async () => {
  let listener;
  let launches = 0;
  let sends = 0;
  const storage = {};
  const local = { origins: ['https://other-kaoz.example'] };
  const area = data => ({ get: async key => ({ [key]: data[key] }), set: async values => Object.assign(data, values) });
  globalThis.chrome = {
    runtime: { getManifest: () => ({ version: '0.2.0' }), onMessageExternal: { addListener(value) { listener = value; } } },
    storage: { session: area(storage), local: area(local) },
    scripting: { executeScript: async () => {} },
    tabs: {
      create: async () => ({ id: ++launches }),
      get: async () => ({ status: 'complete', url: 'https://flow.google.com/' }),
      sendMessage: async (_id, message) => {
        if (message.type === 'start') { sends++; return { ok: true }; }
        return { ok: true, status: 'completed', images: [{ url: 'https://flow-content.google/image/123', width: 1024, height: 1024 }], projectUrl: 'https://flow.google.com/project/test' };
      },
    },
  };
  await import('../extensions/flow-companion/background.mjs?first');
  const sender = { url: 'http://localhost:3000/flow/images', tab: { id: 100 } };
  const send = (message, owner = sender) => new Promise(resolve => listener(message, owner, resolve));
  const request = { type: 'start', requestId: 'test-request-123', prompt: 'A greenhouse', options: {} };
  assert.equal((await send(request)).ok, true);
  await import('../extensions/flow-companion/background.mjs?restart');
  assert.equal((await send(request)).jobId, request.requestId);
  assert.equal(launches, 1);
  assert.equal(sends, 1);
  const other = { url: 'https://other-kaoz.example/flow/images', tab: { id: 101 } };
  assert.equal((await send({ type: 'status', jobId: request.requestId }, other)).ok, false);
  const result = await send({ type: 'status', jobId: request.requestId });
  assert.equal(result.status, 'completed');
  assert.equal((await send({ type: 'acknowledge', jobId: request.requestId })).ok, true);
  delete globalThis.chrome;
});

test('desktop bridge accepts localhost and rejects hosts outside loopback', async (t) => {
  const originalFetch = globalThis.fetch;
  const polled = [];
  let portListener;
  globalThis.fetch = async (url) => {
    polled.push(String(url));
    return { ok: true, json: async () => ({ command: null }) };
  };
  const area = data => ({ get: async key => ({ [key]: data[key] }), set: async values => Object.assign(data, values) });
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.3.1' }),
      onMessageExternal: { addListener() {} },
      connectNative: () => ({
        onMessage: { addListener(listener) { portListener = listener; } },
        onDisconnect: { addListener() {} },
        postMessage() {},
      }),
    },
    storage: { session: area({}), local: area({}) },
    scripting: { executeScript: async () => {} },
    tabs: {},
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete globalThis.chrome;
  });

  await import('../extensions/flow-companion/background.mjs?native');
  assert.equal(typeof portListener, 'function');

  // Host fora de loopback nunca vira destino.
  portListener({ type: 'configure', baseUrl: 'http://evil.test:4321', token: 'd'.repeat(64), desktopPid: 1 });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(polled, []);

  // Localhost é o que o Next reporta: precisa ser aceito.
  portListener({ type: 'configure', baseUrl: 'http://localhost:4321', token: 'e'.repeat(64), desktopPid: 2 });
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.ok(
    polled.some(url => url.startsWith('http://localhost:4321/api/flow/desktop-companion')),
    `esperava chamada para localhost:4321, veio ${JSON.stringify(polled)}`
  );

  // Encerra o runner para não deixar temporizador pendente no fim da suíte.
  portListener({ type: 'unavailable' });
  await new Promise(resolve => setTimeout(resolve, 1700));
});

test('popup keeps the Kaoz.1 surface and ships every asset it declares', () => {
  const root = path.resolve('extensions/flow-companion');
  const popup = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  assert.match(popup, /<link rel="stylesheet" href="popup\.css">/);
  assert.match(popup, /<script type="module" src="popup\.js"><\/script>/);
  for (const control of ['origin', 'connect', 'disconnect']) assert.match(popup, new RegExp(`id="${control}"`));
  assert.match(popup, /id="status" class="kaoz-feedback" role="status"/);
  assert.match(popup, /id="version"/);

  // A paleta e a tipografia técnica precisam ser as mesmas do app.
  const appStyles = fs.readFileSync(path.resolve('app/globals.css'), 'utf8');
  const popupStyles = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');
  for (const token of ['--palette-accent', '--palette-void', '--palette-stone', '--signal-bright']) {
    assert.ok(appStyles.includes(`${token}:`) && popupStyles.includes(`${token}:`), token);
  }
  assert.match(popupStyles, /IBM Plex Mono/);
  assert.match(popupStyles, /clip-path: polygon\(/);

  const declared = [
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    'popup.html', 'popup.css', 'popup.js', 'protocol.mjs',
    'assets/kaoz-mark.png', 'fonts/ibm-plex-mono-400.woff2', 'fonts/ibm-plex-mono-600.woff2',
  ];
  for (const file of declared) {
    const target = path.join(root, file);
    assert.ok(fs.statSync(target).size > 0, `asset ausente ou vazio: ${file}`);
  }
});

test('service worker reports bridge state and the tracked request to the popup', async (t) => {
  let listener;
  const data = {
    origins: ['http://localhost:3000'],
    jobs: {
      'running-job-1': { id: 'running-job-1', owner: 'http://localhost:3000', status: 'running', startedAt: 2 },
      'done-job-2': { id: 'done-job-2', owner: 'http://localhost:3000', status: 'completed', startedAt: 1 },
    },
  };
  const area = source => ({ get: async key => ({ [key]: source[key] }), set: async values => Object.assign(source, values) });
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.4.0' }),
      onMessageExternal: { addListener() {} },
      onMessage: { addListener(value) { listener = value; } },
    },
    storage: { session: area({}), local: area(data) },
    scripting: { executeScript: async () => {} },
    tabs: {},
  };
  t.after(() => { delete globalThis.chrome; });

  await import('../extensions/flow-companion/background.mjs?popup-state');
  assert.equal(typeof listener, 'function');
  const ask = message => new Promise(resolve => assert.equal(listener(message, {}, resolve), true));

  const state = await ask({ type: 'companion-state' });
  assert.equal(state.ok, true);
  assert.equal(state.version, '0.4.0');
  assert.deepEqual(state.origins, ['http://localhost:3000']);
  assert.equal(state.desktop, false);
  assert.deepEqual(state.active, { id: 'running-job-1', status: 'running', owner: 'http://localhost:3000' });

  assert.equal(listener({ type: 'ping' }, {}, () => {}), false);
});
