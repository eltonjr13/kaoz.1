#!/usr/bin/env node

/**
 * Kaoz.1 Cortex Cognitive Hub — Standalone E2E Test Runner
 *
 * Requirements:
 * - Pure Node.js ESM execution on Windows (`node tests/e2e/cortex/test-runner.mjs`)
 * - Exit code 0 on 100% pass, exit code 1 on failure
 * - Clear, rich terminal reporting with per-tier statistics and executive summary
 */

import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for ANSI terminal
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
};

// Parse command-line flags
const args = process.argv.slice(2);
const options = {
  tier: null,
  filter: null,
  verbose: false,
};

for (const arg of args) {
  if (arg.startsWith('--tier=')) {
    options.tier = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--filter=')) {
    options.filter = arg.split('=')[1];
  } else if (arg === '--verbose' || arg === '-v') {
    options.verbose = true;
  }
}

async function run() {
  const overallStart = performance.now();

  console.log(`\n${colors.bold}${colors.cyan}========================================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}  KAOZ.1 CORTEX COGNITIVE HUB — OPAQUE-BOX E2E TEST RUNNER             ${colors.reset}`);
  console.log(`${colors.dim}  Environment: Node.js ${process.version} | OS: ${process.platform} (${process.arch})${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}========================================================================${colors.reset}\n`);

  // Dynamically load test suites
  const suitesToRun = [];

  try {
    if (!options.tier || options.tier === 1) {
      const { default: tier1Suite } = await import('./tier1-feature-coverage.test.mjs');
      suitesToRun.push(tier1Suite);
    }
    if (!options.tier || options.tier === 2) {
      const { default: tier2Suite } = await import('./tier2-boundary-corner.test.mjs');
      suitesToRun.push(tier2Suite);
    }
    if (!options.tier || options.tier === 3) {
      const { default: tier3Suite } = await import('./tier3-cross-feature.test.mjs');
      suitesToRun.push(tier3Suite);
    }
    if (!options.tier || options.tier === 4) {
      const { default: tier4Suite } = await import('./tier4-application.test.mjs');
      suitesToRun.push(tier4Suite);
    }
  } catch (loadErr) {
    console.error(`${colors.red}${colors.bold}Error loading test suites:${colors.reset}`, loadErr);
    process.exit(1);
  }

  const tierSummaries = [];
  let grandTotal = 0;
  let grandPassed = 0;
  let grandFailed = 0;
  let grandSkipped = 0;

  for (const suite of suitesToRun) {
    console.log(`${colors.bold}${colors.blue}▶ [TIER ${suite.tierNumber}] ${suite.tierName}${colors.reset}`);
    console.log(`  ${colors.dim}${suite.description}${colors.reset}`);

    const tierStart = performance.now();
    const suiteResult = await suite.run({ filter: options.filter, verbose: false });
    const tierDuration = performance.now() - tierStart;

    grandTotal += suiteResult.total;
    grandPassed += suiteResult.passed;
    grandFailed += suiteResult.failed;
    grandSkipped += suiteResult.skipped;

    // Display individual test outcomes
    for (const test of suiteResult.results) {
      if (test.status === 'passed') {
        console.log(`  ${colors.green}✓${colors.reset} ${test.name} ${colors.dim}(${test.duration.toFixed(1)}ms)${colors.reset}`);
      } else if (test.status === 'failed') {
        console.log(`  ${colors.red}✗${colors.reset} ${colors.bold}${colors.red}${test.name}${colors.reset} ${colors.dim}(${test.duration.toFixed(1)}ms)${colors.reset}`);
        if (test.error) {
          const formattedError = (test.error.stack || test.error.message || String(test.error))
            .split('\n')
            .map((line) => `    ${colors.red}${line}${colors.reset}`)
            .join('\n');
          console.log(`${formattedError}`);
        }
      } else if (test.status === 'skipped') {
        console.log(`  ${colors.yellow}○${colors.reset} ${colors.dim}${test.name} (skipped)${colors.reset}`);
      }
    }

    tierSummaries.push({
      tierNumber: suite.tierNumber,
      name: suite.tierName,
      total: suiteResult.total,
      passed: suiteResult.passed,
      failed: suiteResult.failed,
      skipped: suiteResult.skipped,
      duration: tierDuration,
    });

    console.log();
  }

  const overallDuration = performance.now() - overallStart;

  // Executive Summary Table
  console.log(`${colors.bold}========================================================================${colors.reset}`);
  console.log(`${colors.bold}  EXECUTIVE SUMMARY BY TIER                                            ${colors.reset}`);
  console.log(`${colors.bold}========================================================================${colors.reset}`);
  console.log(`  ${'Tier'.padEnd(10)} | ${'Tests'.padStart(6)} | ${'Passed'.padStart(7)} | ${'Failed'.padStart(7)} | ${'Skipped'.padStart(8)} | ${'Duration'.padStart(10)}`);
  console.log(`  ${'-'.repeat(10)}-+-${'-'.repeat(6)}-+-${'-'.repeat(7)}-+-${'-'.repeat(7)}-+-${'-'.repeat(8)}-+-${'-'.repeat(10)}`);

  for (const s of tierSummaries) {
    const statusColor = s.failed > 0 ? colors.red : colors.green;
    console.log(
      `  ${`Tier ${s.tierNumber}`.padEnd(10)} | ${String(s.total).padStart(6)} | ${statusColor}${String(s.passed).padStart(7)}${colors.reset} | ${s.failed > 0 ? colors.red : ''}${String(s.failed).padStart(7)}${colors.reset} | ${String(s.skipped).padStart(8)} | ${(s.duration.toFixed(1) + 'ms').padStart(10)}`
    );
  }

  console.log(`  ${'-'.repeat(10)}-+-${'-'.repeat(6)}-+-${'-'.repeat(7)}-+-${'-'.repeat(7)}-+-${'-'.repeat(8)}-+-${'-'.repeat(10)}`);
  const finalStatusColor = grandFailed > 0 ? colors.red : colors.green;
  console.log(
    `  ${colors.bold}${'TOTAL'.padEnd(10)}${colors.reset} | ${String(grandTotal).padStart(6)} | ${finalStatusColor}${String(grandPassed).padStart(7)}${colors.reset} | ${grandFailed > 0 ? colors.red : ''}${String(grandFailed).padStart(7)}${colors.reset} | ${String(grandSkipped).padStart(8)} | ${(overallDuration.toFixed(1) + 'ms').padStart(10)}`
  );
  console.log(`${colors.bold}========================================================================${colors.reset}\n`);

  if (grandFailed === 0) {
    console.log(`${colors.bold}${colors.green}✔ ALL CORTEX E2E TESTS PASSED (${grandPassed}/${grandTotal}) — Integrity Guaranteed!${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${colors.bold}${colors.red}✖ TEST SUITE FAILED: ${grandFailed} failure(s) detected out of ${grandTotal} test(s).${colors.reset}\n`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(`${colors.red}Fatal runner exception:${colors.reset}`, err);
  process.exit(1);
});
