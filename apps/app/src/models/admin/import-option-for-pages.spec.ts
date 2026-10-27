import { ImportMode } from './import-mode';
import {
  ImportOptionForPages,
  isImportOptionForPages,
} from './import-option-for-pages';
import { ImportOptionForRevisions } from './import-option-for-revisions';

/**
 * Regression test for #11341.
 *
 * Under `useDefineForClassFields` (Next.js 14->16 / Turbopack target ESNext),
 * a bare class-field declaration (`isOverwriteAuthorWithCurrentUser: boolean;`
 * with no initializer) emits `this.x = undefined` AFTER `super()` runs. That
 * clobbered the values GrowiArchiveImportOption's constructor had just
 * assigned from initProps, so every marker property silently became
 * `undefined` and was dropped by `JSON.stringify` (undefined-valued keys are
 * omitted). The server's `isImportOptionForPages` guard
 * (`'isOverwriteAuthorWithCurrentUser' in opt`) then read `false`, and
 * `POST /_api/v3/import` threw "Invalid option for pages" for every request.
 *
 * These tests exercise the same JSON.parse(JSON.stringify(...)) round trip
 * the client performs when it serializes the option into the request body,
 * so a regression to bare field declarations turns this suite RED again.
 */
describe('ImportOptionForPages JSON round-trip', () => {
  it('keeps all five marker properties (as false) after a round trip with default props', () => {
    const option = new ImportOptionForPages('pages', ImportMode.upsert);

    const roundTripped = JSON.parse(JSON.stringify(option));

    expect(roundTripped).toMatchObject({
      isOverwriteAuthorWithCurrentUser: false,
      makePublicForGrant2: false,
      makePublicForGrant4: false,
      makePublicForGrant5: false,
      initPageMetadatas: false,
    });
  });

  it('is still recognized by isImportOptionForPages after the round trip', () => {
    const option = new ImportOptionForPages('pages', ImportMode.upsert);

    const roundTripped = JSON.parse(JSON.stringify(option));

    expect(isImportOptionForPages(roundTripped)).toBe(true);
  });

  it('preserves custom initProps values after the round trip', () => {
    const customProps = {
      isOverwriteAuthorWithCurrentUser: true,
      makePublicForGrant2: true,
      makePublicForGrant4: false,
      makePublicForGrant5: true,
      initPageMetadatas: false,
    };
    const option = new ImportOptionForPages(
      'pages',
      ImportMode.upsert,
      customProps,
    );

    const roundTripped = JSON.parse(JSON.stringify(option));

    expect(roundTripped).toMatchObject(customProps);
  });
});

describe('ImportOptionForRevisions JSON round-trip', () => {
  it('keeps isOverwriteAuthorWithCurrentUser (as false) after a round trip with default props', () => {
    const option = new ImportOptionForRevisions('revisions', ImportMode.upsert);

    const roundTripped = JSON.parse(JSON.stringify(option));

    expect(roundTripped).toMatchObject({
      isOverwriteAuthorWithCurrentUser: false,
    });
  });
});
