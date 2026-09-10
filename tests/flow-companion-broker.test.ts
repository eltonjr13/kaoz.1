import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { browserImageContext, browserTransportToken, withBrowserImageTransport } from '../lib/flow/browser-image-context.ts';
import { requestBrowserImage, nextBrowserImage, completeBrowserImage } from '../lib/flow/browser-image-broker.ts';
import { getSketchJobsDir } from '../lib/runtime-paths.ts';

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
