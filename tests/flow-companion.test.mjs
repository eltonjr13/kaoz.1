import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { allowedSender, allowedImage, validPrompt } from '../extensions/flow-companion/protocol.mjs';

test('only the local proof page can command the extension', () => {
  assert.equal(allowedSender({ url: 'http://localhost:3000/flow-extension-test.html?extensionId=abc' }), true);
  for (const url of ['https://evil.test', 'http://localhost:3001/flow-extension-test.html', 'http://localhost:3000/other', 'http://localhost.evil.test:3000/flow-extension-test.html', 'invalid']) {
    assert.equal(allowedSender({ url }), false, url);
  }
  assert.equal(allowedSender({}), false);
});

test('prompts and image origins are bounded', () => {
  assert.equal(validPrompt('A white astronaut chicken'), true);
  for (const prompt of ['', '  ', null, {}, 'x'.repeat(4001)]) assert.equal(validPrompt(prompt), false);
  assert.equal(allowedImage('https://lh3.googleusercontent.com/image'), true);
  for (const url of ['http://lh3.googleusercontent.com/image', 'https://evil.test/image', 'https://googleusercontent.com.evil.test/image', 'https://user:password@labs.google/image', 'data:image/png;base64,eA==']) assert.equal(allowedImage(url), false);
});

async function contentFixture({ existingText = '', modelText = 'Nano Banana 2 x1' } = {}) {
  let listener;
  let clicks = 0;
  const bounds = () => ({ width: 600, height: 300 });
  const composer = { textContent: existingText, focus() {}, getBoundingClientRect: bounds };
  const submit = { disabled: false, textContent: 'Iniciar geração', getAttribute: () => 'Iniciar geração', getBoundingClientRect: bounds, click() { clicks++; } };
  const model = { textContent: modelText, getAttribute: () => null, getBoundingClientRect: bounds };
  const images = [{ src: 'https://lh3.googleusercontent.com/old', naturalWidth: 1024, naturalHeight: 1024, getBoundingClientRect: bounds, closest: () => null }];
  const context = vm.createContext({
    window: {}, setTimeout, Date, location: { href: 'https://flow.google.com/project/test' },
    chrome: { runtime: { id: 'extension', onMessage: { addListener(value) { listener = value; } } } },
    document: { images, querySelectorAll: selector => selector === 'button' ? [submit, model] : [composer], execCommand(_command, _ui, value) { composer.textContent = value; return true; } },
  });
  const code = await readFile(new URL('../extensions/flow-companion/flow-content.js', import.meta.url), 'utf8');
  vm.runInContext(code, context);
  vm.runInContext(code, context);
  const send = message => new Promise(resolve => listener(message, { id: 'extension' }, resolve));
  return { send, images, clicks: () => clicks };
}

test('content script submits once and excludes images from before the request', async () => {
  const fixture = await contentFixture();
  assert.equal((await fixture.send({ type: 'start', id: 'one', prompt: 'Astronaut chicken' })).ok, true);
  assert.equal((await fixture.send({ type: 'start', id: 'two', prompt: 'Duplicate' })).ok, false);
  assert.equal(fixture.clicks(), 1);
  assert.equal((await fixture.send({ type: 'status', id: 'one' })).status, 'running');
  fixture.images.push({ ...fixture.images[0], src: 'https://lh3.googleusercontent.com/new' });
  const result = await fixture.send({ type: 'status', id: 'one' });
  assert.equal(result.status, 'completed');
  assert.equal(result.imageUrl, 'https://lh3.googleusercontent.com/new');
});

test('content script preserves drafts and refuses video or multiple-image settings', async () => {
  for (const options of [{ existingText: 'User draft' }, { modelText: 'Veo x1' }, { modelText: 'Nano Banana 2 x4' }]) {
    const fixture = await contentFixture(options);
    assert.equal((await fixture.send({ type: 'start', id: 'one', prompt: 'Test' })).ok, false);
    assert.equal(fixture.clicks(), 0);
  }
});
