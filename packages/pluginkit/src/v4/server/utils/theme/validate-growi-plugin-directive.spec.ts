import path from 'node:path';
import { isGrowiThemeMetadata } from '@growi/core';

import { validateThemePluginGrowiDirective } from './validate-growi-plugin-directive';

describe('validateThemePluginGrowiDirective()', () => {
  it('returns a data object', async () => {
    // setup
    const projectDirRoot = path.resolve(
      __dirname,
      '../../../../../test/fixtures/example-package/theme1',
    );

    // when
    const data = validateThemePluginGrowiDirective(projectDirRoot);

    // then
    expect(data).not.toBeNull();
    expect(data.growiPlugin).not.toBeNull();
    expect(data.themes).not.toBeNull();
    expect(isGrowiThemeMetadata(data.themes[0])).toBeTruthy();
  });

  describe('should throw an GrowiPluginValidationError', () => {
    it("when the pkg does not have 'growiPlugin.themes' directive", () => {
      // setup
      const projectDirRoot = path.resolve(
        __dirname,
        '../../../../../test/fixtures/example-package/invalid-theme1',
      );

      // when
      const caller = () => {
        validateThemePluginGrowiDirective(projectDirRoot);
      };

      // then
      expect(caller).toThrow(
        "Theme plugin must have 'themes' array and that must have one or more theme metadata",
      );
    });

    it("when the pkg does not have 'growiPlugin.locale' directive", () => {
      // setup
      const projectDirRoot = path.resolve(
        __dirname,
        '../../../../../test/fixtures/example-package/invalid-theme2',
      );

      // when
      const caller = () => {
        validateThemePluginGrowiDirective(projectDirRoot);
      };

      // then
      expect(caller).toThrow(/^Some of theme metadata are invalid:/);
    });
  });
});
