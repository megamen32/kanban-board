import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test('discovers source tests once without generated or isolated-worktree copies', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'kanban-test-discovery-'));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const require = createRequire(import.meta.url);
  const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  const canonical = ['src/visible.test.ts', 'tests/other.spec.ts'];
  const excluded = [
    '.agents/tasks/old/src/visible.test.ts',
    '.tmp/preview/src/visible.test.ts',
    '.next/standalone/src/visible.test.ts',
    '.worktrees/parallel/src/visible.test.ts',
    'node_modules/example/visible.test.ts',
  ];

  try {
    for (const name of [...canonical, ...excluded]) {
      const file = join(fixture, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "throw new Error('Discovery must not execute fixtures');\n");
    }
    const output = execFileSync(process.execPath, [
      vitest, 'list', '--filesOnly', '--json',
      '--root', fixture, '--config', join(root, 'vitest.config.ts'),
    ], { cwd: root, encoding: 'utf8', timeout: 15_000 });
    const files = (JSON.parse(output) as { file: string }[])
      .map(({ file }) => relative(fixture, file).replaceAll('\\', '/')).sort();

    expect(files).toEqual([...canonical].sort());
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}, 20_000);
