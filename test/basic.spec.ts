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

import { test, expect } from './config';

test('should fail', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'one-failure.spec.ts': `
      test('fails', () => {
        expect(1 + 1).toBe(7);
      });
    `
  });
  expect(result.exitCode).toBe(1);
  expect(result.passed).toBe(0);
  expect(result.failed).toBe(1);
  expect(result.output).toContain('1) one-failure.spec.ts:5');
});

test('should timeout', async ({ runInlineTest }) => {
  const { exitCode, passed, failed, output } = await runInlineTest({
    'one-timeout.spec.js': `
      test('timeout', async () => {
        await new Promise(f => setTimeout(f, 10000));
      });
    `
  }, { timeout: 100 });
  expect(exitCode).toBe(1);
  expect(passed).toBe(0);
  expect(failed).toBe(1);
  expect(output).toContain('Timeout of 100ms exceeded.');
});

test('should succeed', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'one-success.spec.js': `
      test('succeeds', () => {
        expect(1 + 1).toBe(2);
      });
    `
  });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(1);
  expect(result.failed).toBe(0);
});

test('should report suite errors', async ({ runInlineTest }) => {
  const { exitCode, failed, output } = await runInlineTest({
    'suite-error.spec.js': `
      if (new Error().stack.includes('workerRunner'))
        throw new Error('Suite error');

      test('passes',() => {
        expect(1 + 1).toBe(2);
      });
    `
  });
  expect(exitCode).toBe(1);
  expect(failed).toBe(1);
  expect(output).toContain('Suite error');
});

test('should respect nested skip', async ({ runInlineTest }) => {
  const { exitCode, passed, failed, skipped } = await runInlineTest({
    'nested-skip.spec.js': `
      test.describe('skipped', () => {
        test.skip();
        test('succeeds',() => {
          expect(1 + 1).toBe(2);
        });
      });
    `
  });
  expect(exitCode).toBe(0);
  expect(passed).toBe(0);
  expect(failed).toBe(0);
  expect(skipped).toBe(1);
});

test('should respect excluded tests', async ({ runInlineTest }) => {
  const { exitCode, passed } = await runInlineTest({
    'excluded.spec.ts': `
      test('included test', () => {
        expect(1 + 1).toBe(2);
      });

      test('excluded test', () => {
        test.skip();
        expect(1 + 1).toBe(3);
      });

      test('excluded test', () => {
        test.skip();
        expect(1 + 1).toBe(3);
      });

      test.describe('included describe', () => {
        test('included describe test', () => {
          expect(1 + 1).toBe(2);
        });
      });

      test.describe('excluded describe', () => {
        test.skip();
        test('excluded describe test', () => {
          expect(1 + 1).toBe(3);
        });
      });
    `,
  });
  expect(passed).toBe(2);
  expect(exitCode).toBe(0);
});

test('should respect focused tests', async ({ runInlineTest }) => {
  const { exitCode, passed } = await runInlineTest({
    'focused.spec.ts': `
      test('included test', () => {
        expect(1 + 1).toBe(3);
      });

      test.only('focused test', () => {
        expect(1 + 1).toBe(2);
      });

      test.only('focused only test', () => {
        expect(1 + 1).toBe(2);
      });

      test.describe.only('focused describe', () => {
        test('describe test', () => {
          expect(1 + 1).toBe(2);
        });
      });

      test.describe('non-focused describe', () => {
        test('describe test', () => {
          expect(1 + 1).toBe(3);
        });
      });

      test.describe.only('focused describe', () => {
        test('test1', () => {
          expect(1 + 1).toBe(2);
        });
        test.only('test2', () => {
          expect(1 + 1).toBe(2);
        });
        test('test3', () => {
          expect(1 + 1).toBe(2);
        });
        test.only('test4', () => {
          expect(1 + 1).toBe(2);
        });
      });
    `
  });
  expect(passed).toBe(5);
  expect(exitCode).toBe(0);
});

test('skip should take priority over fail', async ({ runInlineTest }) => {
  const { passed, skipped, failed } = await runInlineTest({
    'test.spec.ts': `
      test.describe('failing suite', () => {
        test.fail();

        test('skipped', () => {
          test.skip();
          expect(1 + 1).toBe(3);
        });

        test('passing', () => {
          expect(1 + 1).toBe(3);
        });
        test('passing2', () => {
          expect(1 + 1).toBe(3);
        });

        test('failing', () => {
          expect(1 + 1).toBe(2);
        });
      });
    `
  });
  expect(passed).toBe(2);
  expect(skipped).toBe(1);
  expect(failed).toBe(1);
});
