/**
 * Copyright Microsoft Corporation. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test, expect } from './config';

test('hooks should work with env', async ({ runInlineTest }) => {
  const { results } = await runInlineTest({
    'folio.config.ts': `
      global.logs = [];
      class MyEnv {
        async beforeAll() {
          global.logs.push('+w');
          return { w: 17 };
        }
        async afterAll() {
          global.logs.push('-w');
        }
        async beforeEach() {
          global.logs.push('+t');
          return { t: 42 };
        }
        async afterEach() {
          global.logs.push('-t');
        }
      }
      export const test = folio.test;
      test.runWith(new MyEnv());
    `,
    'a.test.js': `
      const { test } = require('./folio.config');
      test.describe('suite', () => {
        test.beforeAll(async ({ w }) => {
          global.logs.push('beforeAll-' + w);
        });
        test.afterAll(async ({ w }) => {
          global.logs.push('afterAll-' + w);
        });

        test.beforeEach(async ({t}) => {
          global.logs.push('beforeEach-' + t);
        });
        test.afterEach(async ({t}) => {
          global.logs.push('afterEach-' + t);
        });

        test('one', async ({t}) => {
          global.logs.push('test');
          expect(t).toBe(42);
        });
      });

      test('two', async () => {
        expect(global.logs).toEqual([
          '+w',
          'beforeAll-17',
          '+t',
          'beforeEach-42',
          'test',
          'afterEach-42',
          '-t',
          'afterAll-17',
          '+t',
        ]);
      });
    `,
  });
  expect(results[0].status).toBe('passed');
});

test('afterEach failure should not prevent other hooks and env teardown', async ({ runInlineTest }) => {
  const report = await runInlineTest({
    'folio.config.ts': `
      global.logs = [];
      class MyEnv {
        async beforeEach() {
          console.log('+t');
        }
        async afterEach() {
          console.log('-t');
        }
      }
      export const test = folio.test;
      test.runWith(new MyEnv());
    `,
    'a.test.js': `
      const { test } = require('./folio.config');
      test.describe('suite', () => {
        test.afterEach(async () => {
          console.log('afterEach1');
        });
        test.afterEach(async () => {
          console.log('afterEach2');
          throw new Error('afterEach2');
        });
        test('one', async () => {
          console.log('test');
          expect(true).toBe(true);
        });
      });
    `,
  });
  expect(report.output).toContain('+t\ntest\nafterEach2\nafterEach1\n-t');
  expect(report.results[0].error.message).toContain('afterEach2');
});

test('beforeEach failure should prevent the test, but not other hooks', async ({ runInlineTest }) => {
  const report = await runInlineTest({
    'a.test.js': `
      test.describe('suite', () => {
        test.beforeEach(async ({}) => {
          console.log('beforeEach1');
        });
        test.beforeEach(async ({}) => {
          console.log('beforeEach2');
          throw new Error('beforeEach2');
        });
        test.afterEach(async ({}) => {
          console.log('afterEach');
        });
        test('one', async ({}) => {
          console.log('test');
        });
      });
    `,
  });
  expect(report.output).toContain('beforeEach1\nbeforeEach2\nafterEach');
  expect(report.results[0].error.message).toContain('beforeEach2');
});

test('beforeAll should be run once', async ({ runInlineTest }) => {
  const report = await runInlineTest({
    'a.test.js': `
      test.describe('suite1', () => {
        let counter = 0;
        test.beforeAll(async () => {
          console.log('beforeAll1-' + (++counter));
        });
        test.describe('suite2', () => {
          test.beforeAll(async () => {
            console.log('beforeAll2');
          });
          test('one', async ({}) => {
            console.log('test');
          });
        });
      });
    `,
  });
  expect(report.output).toContain('beforeAll1-1\nbeforeAll2\ntest');
});

test('beforeEach should be able to skip a test', async ({ runInlineTest }) => {
  const { passed, skipped, exitCode } = await runInlineTest({
    'a.test.js': `
      test.beforeEach(async ({}, testInfo) => {
        testInfo.skip(testInfo.title === 'test2');
      });
      test('test1', async () => {});
      test('test2', async () => {});
    `,
  });
  expect(exitCode).toBe(0);
  expect(passed).toBe(1);
  expect(skipped).toBe(1);
});

test('beforeAll from a helper file should throw', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'my-test.ts': `
      export const test = folio.test;
      test.beforeAll(() => {});
    `,
    'folio.config.ts': `
      import { test } from './my-test';
      test.runWith();
    `,
    'a.test.ts': `
      import { test } from './my-test';
      test('should work', async () => {
      });
    `,
  });
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain('Hook can only be defined in a test file');
});
