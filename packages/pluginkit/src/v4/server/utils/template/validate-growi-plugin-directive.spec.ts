import path from 'node:path';
import { GrowiPluginType } from '@growi/core';

import { validateTemplatePluginGrowiDirective } from './validate-growi-plugin-directive';

describe('validateTemplatePluginGrowiDirective()', () => {
  it('returns a data object', async () => {
    // setup
    const projectDirRoot = path.resolve(
      __dirname,
      '../../../../../test/fixtures/example-package/template1',
    );

    // when
    const data = validateTemplatePluginGrowiDirective(projectDirRoot);

    // then
    expect(data).not.toBeNull();
    expect(data.growiPlugin).not.toBeNull();
    expect(data.growiPlugin.types).toStrictEqual([GrowiPluginType.Template]);
    expect(data.growiPlugin.tylocalespes).not.toBeNull();
  });

  describe('should throw an GrowiPluginValidationError', () => {
    it("when the pkg does not have 'growiPlugin.locale' directive", () => {
      // setup
      const projectDirRoot = path.resolve(
        __dirname,
        '../../../../../test/fixtures/example-package/invalid-template1',
      );

      // when
      const caller = () => {
        validateTemplatePluginGrowiDirective(projectDirRoot);
      };

      // then
      expect(caller).toThrow(
        "Template plugin must have 'supportingLocales' and that must have one or more locales",
      );
    });
  });
});
