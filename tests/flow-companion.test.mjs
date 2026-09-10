import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedSender, allowedImage, validPrompt, appOrigin } from '../extensions/flow-companion/protocol.mjs';

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
