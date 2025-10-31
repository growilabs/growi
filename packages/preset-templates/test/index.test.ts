import path from 'node:path';
import {
  scanAllTemplates,
  validateAllTemplateLocales,
  validateTemplatePluginGrowiDirective,
} from '@growi/pluginkit/dist/v4/server';

const projectDirRoot = path.resolve(__dirname, '../');

it('Validation for package.json should be passed', () => {
  // when
  const caller = () => validateTemplatePluginGrowiDirective(projectDirRoot);

  // then
  expect(caller).not.toThrow();
});

it('Validation for package.json should be return data', () => {
  // when
  const data = validateTemplatePluginGrowiDirective(projectDirRoot);

  // then
  expect(data).not.toBeNull();
});

it('Scanning the templates ends up with no errors', async () => {
  // when
  const results = await scanAllTemplates(projectDirRoot);

  // then
  expect(results).not.toBeNull();
});

it('Scanning the templates ends up with no errors with opts.data', async () => {
  // setup
  const data = validateTemplatePluginGrowiDirective(projectDirRoot);

  // when
  const results = await scanAllTemplates(projectDirRoot, { data });

  // then
  expect(results).not.toBeNull();
});

it('Validation templates returns true', () => {
  // when
  const result = validateAllTemplateLocales(projectDirRoot);

  // then
  expect(result).toBeTruthy();
});
