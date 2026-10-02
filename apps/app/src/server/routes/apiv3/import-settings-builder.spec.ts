import { GrowiArchiveImportOption } from '~/models/admin/growi-archive-import-option';
import { ImportMode } from '~/models/admin/import-mode';
import { ImportOptionForPages } from '~/models/admin/import-option-for-pages';

import { buildImportSettingsMap } from './import-settings-builder';

const OPERATOR_USER_ID = '507f191e810c19729de860ea';

describe('buildImportSettingsMap', () => {
  it('builds an ImportSettings entry per collection, keyed by collectionName', () => {
    const pagesOption = new ImportOptionForPages('pages', ImportMode.upsert, {
      isOverwriteAuthorWithCurrentUser: true,
      makePublicForGrant2: false,
      makePublicForGrant4: false,
      makePublicForGrant5: false,
      initPageMetadatas: false,
    });
    const configsOption = new GrowiArchiveImportOption(
      'configs',
      ImportMode.insert,
    );

    const result = buildImportSettingsMap(
      [
        { fileName: 'pages.json', collectionName: 'pages' },
        { fileName: 'configs.json', collectionName: 'configs' },
      ],
      [pagesOption, configsOption],
      OPERATOR_USER_ID,
    );

    expect(result.size).toBe(2);
    expect(result.get('pages')).toEqual({
      mode: ImportMode.upsert,
      jsonFileName: 'pages.json',
      overwriteParams: expect.any(Object),
    });
    expect(result.get('configs')).toEqual({
      mode: ImportMode.insert,
      jsonFileName: 'configs.json',
      overwriteParams: {},
    });
  });

  it('throws when the pages option is missing its marker properties (#11341 server-side symptom)', () => {
    // Reproduces the exact shape a JSON.stringify of the pre-fix
    // ImportOptionForPages produced: only collectionName/mode survive once the
    // marker properties are clobbered to undefined and dropped by serialization.
    const brokenPagesOption = {
      collectionName: 'pages',
      mode: ImportMode.upsert,
    };

    expect(() =>
      buildImportSettingsMap(
        [{ fileName: 'pages.json', collectionName: 'pages' }],
        [brokenPagesOption],
        OPERATOR_USER_ID,
      ),
    ).toThrow('Invalid option for pages');
  });

  it('throws an explicit error when no option matches the collection being imported', () => {
    const unrelatedOption = new GrowiArchiveImportOption(
      'other',
      ImportMode.insert,
    );

    expect(() =>
      buildImportSettingsMap(
        [{ fileName: 'unmatched.json', collectionName: 'unmatched' }],
        [unrelatedOption],
        OPERATOR_USER_ID,
      ),
    ).toThrow('Import option for unmatched is not found');
  });
});
