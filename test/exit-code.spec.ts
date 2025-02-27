/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test, expect, stripAscii } from './config';

function monotonicTime(): number {
  const [seconds, nanoseconds] = process.hrtime();
  return seconds * 1000 + (nanoseconds / 1000000 | 0);
}

test('should collect stdio', async ({ runInlineTest }) => {
  const { exitCode, report } = await runInlineTest({
    'stdio.spec.js': `
      test('stdio', () => {
        process.stdout.write('stdout text');
        process.stdout.write(Buffer.from('stdout buffer'));
        process.stderr.write('stderr text');
        process.stderr.write(Buffer.from('stderr buffer'));
      });
    `
  });
  expect(exitCode).toBe(0);
  const testResult = report.suites[0].specs[0].tests[0].results[0];
  const { stdout, stderr } = testResult;
  expect(stdout).toEqual([{ text: 'stdout text' }, { buffer: Buffer.from('stdout buffer').toString('base64') }]);
  expect(stderr).toEqual([{ text: 'stderr text' }, { buffer: Buffer.from('stderr buffer').toString('base64') }]);
});

test('should work with not defined errors', async ({runInlineTest}) => {
  const result = await runInlineTest({
    'is-not-defined-error.spec.ts': `
      foo();
    `
  });
  expect(stripAscii(result.output)).toContain('foo is not defined');
  expect(result.exitCode).toBe(1);
});

test('should work with typescript', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'global-foo.js': `
      global.foo = true;
      module.exports = {
        abc: 123
      };
    `,
    'typescript.spec.ts': `
      import './global-foo';

      test('should find global foo', () => {
        expect(global['foo']).toBe(true);
      });

      test('should work with type annotations', () => {
        const x: number = 5;
        expect(x).toBe(5);
      });
    `
  });
  expect(result.exitCode).toBe(0);
});

test('should repeat each', async ({ runInlineTest }) => {
  const { exitCode, report } = await runInlineTest({
    'one-success.spec.js': `
      test('succeeds', () => {
        expect(1 + 1).toBe(2);
      });
    `
  }, { 'repeat-each': 3 });
  expect(exitCode).toBe(0);
  expect(report.suites.length).toBe(1);
  expect(report.suites[0].specs.length).toBe(1);
  expect(report.suites[0].specs[0].tests.length).toBe(3);
});

test('should allow flaky', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'a.test.js': `
      test('flake', async ({}, testInfo) => {
        expect(testInfo.retry).toBe(1);
      });
    `,
  }, { retries: 1 });
  expect(result.exitCode).toBe(0);
  expect(result.flaky).toBe(1);
});

test('should fail on unexpected pass', async ({ runInlineTest }) => {
  const { exitCode, failed, output } = await runInlineTest({
    'unexpected-pass.spec.js': `
      test('succeeds', () => {
        test.fail();
        expect(1 + 1).toBe(2);
      });
    `
  });
  expect(exitCode).toBe(1);
  expect(failed).toBe(1);
  expect(output).toContain('passed unexpectedly');
});

test('should respect global timeout', async ({ runInlineTest }) => {
  const now = monotonicTime();
  const { exitCode, output } = await runInlineTest({
    'one-timeout.spec.js': `
      test('timeout', async () => {
        await new Promise(f => setTimeout(f, 10000));
      });
    `
  }, { 'timeout': 100000, 'global-timeout': 3000 });
  expect(exitCode).toBe(1);
  expect(output).toContain('Timed out waiting 3s for the entire test run');
  expect(monotonicTime() - now).toBeGreaterThan(2900);
});

test('should exit with code 1 if the specified folder does not exist', async ({runInlineTest}) => {
  const result = await runInlineTest({}, { 'test-dir': '111111111111.js' });
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain(`111111111111.js does not exist`);
});

test('should exit with code 1 if passed a file name', async ({runInlineTest}) => {
  const result = await runInlineTest({'test.spec.js': ''}, { 'test-dir': 'test.spec.js' });
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain(`test.spec.js is not a directory`);
});

test('should exit with code 1 when config is not found', async ({runInlineTest}) => {
  const result = await runInlineTest({'my.config.js': ''}, { 'config': 'foo.config.js' });
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain(`foo.config.js does not exist`);
});
