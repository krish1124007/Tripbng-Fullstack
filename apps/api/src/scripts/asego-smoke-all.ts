/**
 * Master ASEGO smoke runner. Runs every script that exercises the live
 * sandbox + Mongo + Redis path, exits non-zero if any fail.
 *
 *   pnpm --filter @tripbng/api exec tsx src/scripts/asego-smoke-all.ts
 *
 * Use as a CI gate before any deploy that touches insurance code.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

interface SmokeStep {
  name: string;
  script: string;
}

const STEPS: SmokeStep[] = [
  { name: 'crypto parity', script: 'asego-crypto-parity.ts' },
  { name: 'master + quote', script: 'asego-smoke.ts' },
  { name: 'validate + issue', script: 'asego-issue-smoke.ts' },
  { name: 'lifecycle (endorse + cancel)', script: 'asego-lifecycle-smoke.ts' },
];

async function runOne(step: SmokeStep): Promise<{ name: string; ok: boolean; ms: number }> {
  const fullPath = resolve(import.meta.dirname, step.script);
  const startedAt = Date.now();
  return new Promise((resolveP) => {
    const child = spawn('npx', ['tsx', fullPath], { stdio: 'inherit' });
    child.on('exit', (code) => {
      resolveP({ name: step.name, ok: code === 0, ms: Date.now() - startedAt });
    });
  });
}

async function main() {
  console.warn('==== ASEGO smoke suite ====');
  const results: Awaited<ReturnType<typeof runOne>>[] = [];
  for (const step of STEPS) {
    console.warn(`\n— ${step.name}`);
    const r = await runOne(step);
    results.push(r);
  }

  console.warn('\n=========================');
  let allOk = true;
  for (const r of results) {
    const tag = r.ok ? '✓' : '✗';
    console.warn(`  ${tag} ${r.name} (${r.ms} ms)`);
    if (!r.ok) allOk = false;
  }
  console.warn(`=========================\n${allOk ? '✅ ALL PASS' : '❌ FAILURES — see above'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
