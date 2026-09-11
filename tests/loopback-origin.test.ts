import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLoopbackHostname,
  isSameOriginOrLoopback,
  parseLoopbackBaseUrl,
} from '../lib/flow/loopback-origin.ts';

test('localhost e 127.0.0.1 são o mesmo host local na mesma porta', () => {
  // Caso real: o Next reconstrói a URL como localhost:3210 e o runtime do
  // desktop grava 127.0.0.1:3210 — antes isso derrubava toda requisição.
  assert.equal(isSameOriginOrLoopback('http://localhost:3210/api/flow/desktop-companion', 'http://127.0.0.1:3210'), true);
  assert.equal(isSameOriginOrLoopback('http://127.0.0.1:3210/api/x', 'http://localhost:3210'), true);
  assert.equal(isSameOriginOrLoopback('http://[::1]:3210/api/x', 'http://localhost:3210'), true);
});

test('porta diferente, host externo ou protocolo diferente continuam recusados', () => {
  assert.equal(isSameOriginOrLoopback('http://localhost:4322/api/x', 'http://127.0.0.1:4321'), false);
  assert.equal(isSameOriginOrLoopback('http://evil.test:4321/api/x', 'http://127.0.0.1:4321'), false);
  assert.equal(isSameOriginOrLoopback('https://localhost:4321/api/x', 'http://127.0.0.1:4321'), false);
  assert.equal(isSameOriginOrLoopback('http://app.kaoz.com:4321/api/x', 'http://app.kaoz.com:4321'), true);
  assert.equal(isSameOriginOrLoopback('not a url', 'http://127.0.0.1:4321'), false);
  assert.equal(isSameOriginOrLoopback(undefined, 'http://127.0.0.1:4321'), false);
});

test('runtime do desktop aceita qualquer grafia de loopback com porta explícita', () => {
  assert.ok(parseLoopbackBaseUrl('http://127.0.0.1:3210'));
  assert.ok(parseLoopbackBaseUrl('http://localhost:3210'));
  assert.ok(parseLoopbackBaseUrl('http://[::1]:3210'));
  assert.equal(parseLoopbackBaseUrl('http://127.0.0.1'), null, 'sem porta explícita não serve');
  assert.equal(parseLoopbackBaseUrl('https://127.0.0.1:3210'), null);
  assert.equal(parseLoopbackBaseUrl('http://evil.test:3210'), null);
  assert.equal(parseLoopbackBaseUrl(''), null);
  assert.equal(isLoopbackHostname('LOCALHOST'), true);
  assert.equal(isLoopbackHostname('kaoz.example'), false);
});
