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

test('basics should work', async ({runTSC}) => {
  const result = await runTSC({
    'a.spec.ts': `
      test.describe('suite', () => {
        test.beforeEach(async () => {});
        test('my test', async({}, testInfo) => {
          expect(testInfo.title).toBe('my test');
          testInfo.data.foo = 'bar';
          testInfo.annotations[0].type;
        });
      });
    `
  });
  expect(result.exitCode).toBe(0);
});

test('can pass sync functions everywhere', async ({runTSC}) => {
  const result = await runTSC({
    'a.spec.ts': `
      test.beforeEach(() => {});
      test.afterEach(() => {});
      test.beforeAll(() => {});
      test.afterAll(() => {});
      test('my test', () => {});
    `
  });
  expect(result.exitCode).toBe(0);
});

test('can return anything from hooks', async ({runTSC}) => {
  const result = await runTSC({
    'a.spec.ts': `
      test.beforeEach(() => '123');
      test.afterEach(() => 123);
      test.beforeAll(() => [123]);
      test.afterAll(() => ({ a: 123 }));
    `
  });
  expect(result.exitCode).toBe(0);
});

test('test.declare should check types', async ({runTSC}) => {
  const result = await runTSC({
    'folio.config.ts': `
      export const test = folio.test;
      export const test1 = test.declare<{ foo: string }>();
      export const test2 = test1.extend({ beforeEach: ({ foo }) => { return { bar: parseInt(foo) }; } });
      test.runWith({});
      test1.runWith({});
      test2.runWith({});
      export const test3 = test1.declare<{ baz: number }>();
      test3.runWith({});
    `,
    'a.spec.ts': `
      import { test, test1, test2, test3 } from './folio.config';
      // @ts-expect-error
      test('my test', async ({ foo }) => {});
      test1('my test', async ({ foo }) => {});
      // @ts-expect-error
      test1('my test', async ({ foo, bar }) => {});
      test2('my test', async ({ foo, bar }) => {});
      test3('my test', async ({ foo, baz }) => {});
      // @ts-expect-error
      test3('my test', async ({ foo, bar }) => {});
      // @ts-expect-error
      test2('my test', async ({ foo, baz }) => {});
    `
  });
  expect(result.exitCode).toBe(0);
});
