import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { browserImageContext, browserTransportToken, withBrowserImageTransport } from '../lib/flow/browser-image-context.ts';
import { requestBrowserImage, nextBrowserImage, completeBrowserImage } from '../lib/flow/browser-image-broker.ts';
import { completeDesktopImage, desktopCompanionStatus, nextDesktopImage, requestDesktopImage } from '../lib/flow/desktop-image-broker.ts';
import { authorizeDesktopCompanion, readDesktopCompanionRuntime } from '../lib/flow/desktop-companion-auth.ts';
import { getSketchJobsDir } from '../lib/runtime-paths.ts';
import os from 'node:os';

test('desktop context stays empty and parallel browser accounts never share tokens', async () => {
  assert.equal(withBrowserImageTransport(undefined, () => browserImageContext.getStore()), undefined);
  const values = await Promise.all(['a', 'b'].map(token => withBrowserImageTransport(token, async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    return browserImageContext.getStore();
  })));
  assert.deepEqual(values, ['a', 'b']);
  assert.equal(browserImageContext.getStore(), undefined);
  assert.throws(() => browserTransportToken(new Request('http://localhost:3000/api/flow/generate', { headers: { 'x-kaoz-flow-browser': 'invalid' } })), /inválida/);
});

test('broker isolates results, rejects corrupt bytes and persists the original image idempotently', async () => {
  const token = 'c'.repeat(64);
  const generation = requestBrowserImage(token, 'A lunar greenhouse', { quantity: 1 });
  const command = nextBrowserImage(token)!;
  assert.ok(command);
  assert.equal(nextBrowserImage('d'.repeat(64)), null);
  await assert.rejects(completeBrowserImage('d'.repeat(64), command.id, { images: [] }), /não encontrado/);
  await assert.rejects(completeBrowserImage(token, command.id, { images: ['data:image/png;base64,YmFk'] }));
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#43806b' } }).png().toBuffer();
  const payload = { images: [`data:image/png;base64,${png.toString('base64')}`] };
  const first = await completeBrowserImage(token, command.id, payload);
  assert.ok(first?.success);
  assert.deepEqual(await fs.readFile(first!.path), png);
  assert.deepEqual(await completeBrowserImage(token, command.id, payload), first);
  assert.deepEqual(await generation, first);
  assert.equal(nextBrowserImage(token), null);
});

test('a reported failure finishes the waiting request without sending another generation', async () => {
  const token = 'e'.repeat(64);
  const generation = requestBrowserImage(token, 'Test', {});
  const rejection = assert.rejects(generation, /Login necessário/);
  const command = nextBrowserImage(token)!;
  await completeBrowserImage(token, command.id, { error: 'Login necessário' });
  await rejection;
  assert.equal(nextBrowserImage(token), null);
});

test('broker accepts the validated reference created by a Sketch job', async () => {
  const token = 'f'.repeat(64);
  const jobsDir = getSketchJobsDir();
  const referencePath = path.join(jobsDir, `ref_job-browser-${Date.now()}.png`);
  await fs.mkdir(jobsDir, { recursive: true });
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#15263c' } }).png().toBuffer();
  await fs.writeFile(referencePath, png);

  try {
    const generation = requestBrowserImage(token, 'Follow this composition', {
      operation: 'reference',
      referenceKind: 'sketch',
      referenceImage: referencePath,
    });
    const rejection = assert.rejects(generation, /Teste encerrado/);
    let command = nextBrowserImage(token);
    for (let attempt = 0; !command && attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      command = nextBrowserImage(token);
    }
    assert.ok(command?.options.referenceImage?.startsWith('data:image/png;base64,'));
    await completeBrowserImage(token, command!.id, { error: 'Teste encerrado' });
    await rejection;
  } finally {
    await fs.rm(referencePath, { force: true });
  }
});

test('desktop broker dispatches once, reports connection and saves an idempotent result', async () => {
  const previousStorage = process.env.KAOZ1_STORAGE_DIR;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kaoz-flow-desktop-'));
  process.env.KAOZ1_STORAGE_DIR = directory;
  try {
    const generation = requestDesktopImage('A chrome connected studio', { quantity: 1, aspectRatio: '3:4' });
    const command = nextDesktopImage('0.3.0');
    assert.ok(command);
    assert.equal(command!.options.aspectRatio, '3:4');
    assert.equal(nextDesktopImage('0.3.0')?.id, command!.id);
    assert.equal(desktopCompanionStatus().connected, true);
    const jpeg = await sharp({ create: { width: 24, height: 32, channels: 3, background: '#352148' } }).jpeg().toBuffer();
    const payload = { images: [`data:image/jpeg;base64,${jpeg.toString('base64')}`] };
    const first = await completeDesktopImage(command!.id, payload);
    assert.ok(first?.success);
    assert.deepEqual(await completeDesktopImage(command!.id, payload), first);
    assert.deepEqual(await generation, first);
    assert.equal(nextDesktopImage('0.3.0'), null);
  } finally {
    if (previousStorage === undefined) delete process.env.KAOZ1_STORAGE_DIR;
    else process.env.KAOZ1_STORAGE_DIR = previousStorage;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('desktop companion accepts only the rotating token for its loopback server', async () => {
  const previous = process.env.KAOZ1_FLOW_NATIVE_RUNTIME_FILE;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kaoz-flow-auth-'));
  const file = path.join(directory, 'runtime.json');
  process.env.KAOZ1_FLOW_NATIVE_RUNTIME_FILE = file;
  const runtime = { baseUrl: 'http://127.0.0.1:4321', token: 'a'.repeat(64), pid: process.pid, updatedAt: new Date().toISOString() };
  await fs.writeFile(file, JSON.stringify(runtime));
  try {
    assert.deepEqual(await readDesktopCompanionRuntime(), runtime);
    const authorized = await authorizeDesktopCompanion(new Request(`${runtime.baseUrl}/api/flow/desktop-companion`, { headers: { authorization: `Bearer ${runtime.token}` } }));
    assert.deepEqual(authorized, runtime);
    await assert.rejects(authorizeDesktopCompanion(new Request(`${runtime.baseUrl}/api/flow/desktop-companion`, { headers: { authorization: 'Bearer invalid' } })), /não autorizada/);
    await assert.rejects(authorizeDesktopCompanion(new Request('http://127.0.0.1:4322/api/flow/desktop-companion', { headers: { authorization: `Bearer ${runtime.token}` } })), /Destino/);
  } finally {
    if (previous === undefined) delete process.env.KAOZ1_FLOW_NATIVE_RUNTIME_FILE;
    else process.env.KAOZ1_FLOW_NATIVE_RUNTIME_FILE = previous;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
