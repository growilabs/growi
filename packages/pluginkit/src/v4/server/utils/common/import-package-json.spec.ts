import path from 'node:path';

import { importPackageJson } from './import-package-json';

it('importPackageJson() returns an object', async () => {
  // when
  const pkg = importPackageJson(
    path.resolve(
      __dirname,
      '../../../../../test/fixtures/example-package/template1',
    ),
  );

  // then
  expect(pkg).not.toBeNull();
});
