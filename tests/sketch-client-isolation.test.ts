import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  createCleanProject,
  createCleanLayers,
  createDefaultProject,
  createDefaultLayers,
  createEmptyBriefing,
  createEmptyCopy,
} from '../lib/sketch/sketch-project-defaults.ts';
import {
  CANVAS_ASPECT_RATIO_PRESETS,
  type FlowSupportedAspectRatio,
  type SketchProjectData,
} from '../types/sketch.ts';

const SUPPORTED_RATIOS: FlowSupportedAspectRatio[] = ['1:1', '9:16', '16:9', '4:3', '3:4'];
const SAFE_ID_PATTERN = /^sketch-\d+-[a-zA-Z0-9_-]{4,16}$/;
const FORBIDDEN_LAYER_IDS = [
  'layer-text-headline',
  'layer-text-subheadline',
  'layer-text-cta',
  'layer-text-badge',
];

function runSubprocess(args: string[]): { stdout: string; exitCode: number; stderr: string } {
  try {
    const stdout = execFileSync('node', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, exitCode: 0, stderr: '' };
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: execErr.stdout ?? '',
      stderr: execErr.stderr ?? '',
      exitCode: execErr.status ?? 1,
    };
  }
}

// ---------------------------------------------------------------------------
// 1. Adversarial Client Isolation & Module Hook Verification
// ---------------------------------------------------------------------------
test('Isolation Oracle: Adversarial loader blocks server storage with ISOLATION_FAULT', () => {
  const result = runSubprocess([
    '--experimental-strip-types',
    '--no-warnings',
    '--loader',
    './tests/helpers/isolation-loader.mjs',
    '--input-type=module',
    '-e',
    'await import("./lib/sketch/sketch-storage.ts");',
  ]);

  assert.notStrictEqual(result.exitCode, 0, 'Server storage must fail when Node built-ins are blocked');
  const combinedOutput = result.stderr + result.stdout;
  assert.match(combinedOutput, /ISOLATION_FAULT/, 'Must trigger ISOLATION_FAULT on node built-in access');
  assert.match(combinedOutput, /node:fs\/promises/, 'Must identify forbidden module access');
});

test('Client Isolation: sketch-project-defaults loads cleanly under hostile Node-blocked loader', () => {
  const result = runSubprocess([
    '--experimental-strip-types',
    '--no-warnings',
    '--loader',
    './tests/helpers/isolation-loader.mjs',
    '--input-type=module',
    '-e',
    `
      const mod = await import("./lib/sketch/sketch-project-defaults.ts");
      const proj = mod.createCleanProject({ aspectRatio: "16:9" });
      if (proj.prompt !== "" || proj.layers.length !== 1) {
        throw new Error("Invalid clean project created under isolation loader");
      }
      console.log("ISOLATION_PASSED");
    `,
  ]);

  assert.strictEqual(result.exitCode, 0, `Expected clean load under isolation loader, got: ${result.stderr}`);
  assert.match(result.stdout, /ISOLATION_PASSED/, 'Defaults module must execute fully without Node built-ins');
});

test('Client Boundary Audit: No component in components/sketch imports sketch-storage or node built-ins', async () => {
  const componentsDir = path.resolve(process.cwd(), 'components', 'sketch');
  const entries = await fsp.readdir(componentsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || (!entry.name.endsWith('.tsx') && !entry.name.endsWith('.ts'))) {
      continue;
    }
    const fullPath = path.join(componentsDir, entry.name);
    const content = await fsp.readFile(fullPath, 'utf8');

    assert.ok(
      !content.includes('sketch-storage'),
      `Component ${entry.name} imports from sketch-storage. Must use sketch-project-defaults!`
    );
    assert.ok(
      !content.includes("from 'node:"),
      `Component ${entry.name} imports Node built-in with 'node:'. Forbidden in client bundle!`
    );
    assert.ok(
      !content.includes('from "node:'),
      `Component ${entry.name} imports Node built-in with "node:". Forbidden in client bundle!`
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Initial Clean State Verification Across All 5 Aspect Ratios
// ---------------------------------------------------------------------------
function verifyCleanStateInvariants(proj: SketchProjectData, expectedRatio: FlowSupportedAspectRatio): void {
  const preset = CANVAS_ASPECT_RATIO_PRESETS[expectedRatio];

  assert.strictEqual(proj.prompt, '', 'Prompt must be empty string');
  assert.strictEqual(proj.aspectRatio, expectedRatio, 'Aspect ratio must match requested');
  assert.strictEqual(proj.canvasAspectRatio, expectedRatio, 'Canvas aspect ratio must match requested');
  assert.strictEqual(proj.canvasDimensions?.width, preset.width, 'Canvas width mismatch');
  assert.strictEqual(proj.canvasDimensions?.height, preset.height, 'Canvas height mismatch');
  assert.strictEqual(proj.document?.dimensions.width, preset.width, 'Document width mismatch');
  assert.strictEqual(proj.document?.dimensions.height, preset.height, 'Document height mismatch');
  assert.strictEqual(proj.attachments.length, 0, 'Must have zero attachments');
  assert.strictEqual(proj.generationHistory.length, 0, 'Must have empty generation history');
  assert.strictEqual(proj.creativeResults?.length, 0, 'Must have empty creative results');
  assert.strictEqual(proj.changeIntents?.length, 0, 'Must have empty change intents');

  // Verify copy fields are clean
  assert.strictEqual(proj.copy.headline, '', 'Copy headline must be empty');
  assert.strictEqual(proj.copy.subheadline, '', 'Copy subheadline must be empty');
  assert.strictEqual(proj.copy.cta, '', 'Copy cta must be empty');
  assert.strictEqual(proj.copy.badge, '', 'Copy badge must be empty');

  // Verify briefing fields are clean
  assert.strictEqual(proj.briefing?.productDescription, '', 'Briefing productDescription must be empty');
  assert.strictEqual(proj.briefing?.targetAudience, '', 'Briefing targetAudience must be empty');
  assert.strictEqual(proj.briefing?.objective, '', 'Briefing objective must be empty');

  // Verify layers: exactly 1 background layer, zero canned promotional text layers
  assert.strictEqual(proj.layers.length, 1, 'Must have exactly 1 layer');
  assert.strictEqual(proj.layers[0].type, 'background', 'Layer must be background type');
  assert.strictEqual(proj.layers[0].id, 'layer-bg-root', 'Layer ID must be layer-bg-root');

  for (const layer of proj.layers) {
    assert.ok(
      !FORBIDDEN_LAYER_IDS.includes(layer.id),
      `Forbidden canned layer ${layer.id} found in clean project`
    );
    assert.notStrictEqual(layer.type, 'text', 'Clean project must not have text layers');
  }
}

test('Clean Project: createCleanProject creates pristine state across all 5 supported aspect ratios', () => {
  for (const ratio of SUPPORTED_RATIOS) {
    const proj = createCleanProject({ aspectRatio: ratio });
    verifyCleanStateInvariants(proj, ratio);
  }
});

test('Clean Project: createDefaultProject with clean=true delegates to clean state across all ratios', () => {
  for (const ratio of SUPPORTED_RATIOS) {
    const proj = createDefaultProject({ clean: true, aspectRatio: ratio });
    verifyCleanStateInvariants(proj, ratio);
  }
});

test('Clean Layers: createCleanLayers produces isolated background layer', () => {
  const layersA = createCleanLayers();
  const layersB = createCleanLayers();

  assert.strictEqual(layersA.length, 1);
  assert.strictEqual(layersB.length, 1);
  assert.notStrictEqual(layersA, layersB, 'createCleanLayers must return distinct array instances');
  assert.notStrictEqual(layersA[0], layersB[0], 'createCleanLayers must return distinct layer object instances');

  assert.strictEqual(layersA[0].type, 'background');
  assert.strictEqual(layersA[0].visible, true);
  assert.strictEqual(layersA[0].opacity, 1);
  assert.strictEqual(layersA[0].elementKind, 'final');
  assert.strictEqual(layersA[0].includeInFinalExport, true);
});

// ---------------------------------------------------------------------------
// 3. Project ID Generation Fallbacks & Robustness
// ---------------------------------------------------------------------------
test('ID Generation: Standard environment produces valid sketch ID', () => {
  const proj = createCleanProject();
  assert.match(proj.id, SAFE_ID_PATTERN, `ID "${proj.id}" must match safe pattern`);
  assert.ok(proj.id.startsWith('sketch-'), 'ID must start with sketch- prefix');
});

test('ID Generation: Gracefully falls back when crypto.randomUUID is undefined', () => {
  const originalCrypto = globalThis.crypto;

  try {
    Object.defineProperty(globalThis, 'crypto', {
      value: { subtle: originalCrypto.subtle, getRandomValues: originalCrypto.getRandomValues },
      configurable: true,
      writable: true,
    });

    const generatedIds = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const proj = createCleanProject();
      assert.match(proj.id, SAFE_ID_PATTERN, `Fallback ID "${proj.id}" must match safe pattern`);
      assert.ok(proj.id.startsWith('sketch-'), 'Fallback ID must start with sketch- prefix');
      generatedIds.add(proj.id);
    }

    assert.strictEqual(generatedIds.size, 25, 'Fallback IDs must be distinct across calls');
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true,
      writable: true,
    });
  }
});

test('ID Generation: Gracefully falls back when crypto is completely undefined', () => {
  const originalCrypto = globalThis.crypto;

  try {
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const proj = createCleanProject();
    assert.match(proj.id, SAFE_ID_PATTERN, `Undefined crypto ID "${proj.id}" must match safe pattern`);
    assert.ok(proj.id.startsWith('sketch-'), 'Undefined crypto ID must start with sketch- prefix');
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true,
      writable: true,
    });
  }
});

test('ID Generation: Explicitly provided ID is strictly honored', () => {
  const customId = 'custom-user-project-42';
  const proj = createCleanProject({ id: customId });
  assert.strictEqual(proj.id, customId, 'Explicit ID must not be overwritten');
});

// ---------------------------------------------------------------------------
// 4. Default vs Clean Comparison & Separation of Concerns
// ---------------------------------------------------------------------------
test('Defaults Comparison: createDefaultProject has demo content whereas clean project has none', () => {
  const demoProj = createDefaultProject();
  const cleanProj = createCleanProject();

  assert.ok(demoProj.prompt.length > 0, 'Demo project has default prompt');
  assert.strictEqual(cleanProj.prompt, '', 'Clean project has empty prompt');

  assert.ok(demoProj.layers.length > 1, 'Demo project has multiple layers');
  assert.strictEqual(cleanProj.layers.length, 1, 'Clean project has only 1 layer');

  assert.ok(demoProj.copy.headline.length > 0, 'Demo project has default headline');
  assert.strictEqual(cleanProj.copy.headline, '', 'Clean project has empty headline');
});
