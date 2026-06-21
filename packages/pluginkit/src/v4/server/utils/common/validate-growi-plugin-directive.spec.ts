import { GrowiPluginType } from '@growi/core';

import examplePkg from '../../../../../test/fixtures/example-package/template1/package.json';
import { validateGrowiDirective } from './validate-growi-plugin-directive';

const mocks = vi.hoisted(() => {
  return {
    importPackageJsonMock: vi.fn(),
  };
});

vi.mock('./import-package-json', () => {
  return { importPackageJson: mocks.importPackageJsonMock };
});

describe('validateGrowiDirective()', () => {
  it('returns a data object', async () => {
    // setup
    mocks.importPackageJsonMock.mockReturnValue(examplePkg);

    // when
    const data = validateGrowiDirective('package.json');

    // then
    expect(data).not.toBeNull();
  });

  it("with the 'expectedPluginType' argument returns a data object", async () => {
    // setup
    mocks.importPackageJsonMock.mockReturnValue(examplePkg);

    // when
    const data = validateGrowiDirective(
      'package.json',
      GrowiPluginType.Template,
    );

    // then
    expect(data).not.toBeNull();
  });

  describe('should throw an GrowiPluginValidationError', () => {
    it("when the pkg does not have 'growiPlugin' directive", () => {
      // setup
      mocks.importPackageJsonMock.mockReturnValue({});

      // when
      const caller = () => {
        validateGrowiDirective('package.json');
      };

      // then
      expect(caller).toThrow(
        "The package.json does not have 'growiPlugin' directive.",
      );
    });

    it("when the 'schemaVersion' is NaN", () => {
      // setup
      mocks.importPackageJsonMock.mockReturnValue({
        growiPlugin: {
          schemaVersion: 'foo',
        },
      });

      // when
      const caller = () => {
        validateGrowiDirective('package.json');
      };

      // then
      expect(caller).toThrow(
        "The growiPlugin directive must have a valid 'schemaVersion' directive.",
      );
    });

    it("when the 'schemaVersion' is less than 4", () => {
      // setup
      mocks.importPackageJsonMock.mockReturnValue({
        growiPlugin: {
          schemaVersion: 3,
        },
      });

      // when
      const caller = () => {
        validateGrowiDirective('package.json');
      };

      // then
      expect(caller).toThrow(
        "The growiPlugin directive must have a valid 'schemaVersion' directive.",
      );
    });

    it("when the 'types' directive does not exist", () => {
      // setup
      mocks.importPackageJsonMock.mockReturnValue({
        growiPlugin: {
          schemaVersion: 4,
        },
      });

      // when
      const caller = () => {
        validateGrowiDirective('package.json');
      };

      // then
      expect(caller).toThrow(
        "The growiPlugin directive does not have 'types' directive.",
      );
    });

    it("when the 'types' directive does not have expected plugin type", () => {
      // setup
      mocks.importPackageJsonMock.mockReturnValue({
        growiPlugin: {
          schemaVersion: 4,
          types: [GrowiPluginType.Template],
        },
      });

      // when
      const caller = () => {
        validateGrowiDirective('package.json', GrowiPluginType.Script);
      };

      // then
      expect(caller).toThrow(
        "The growiPlugin directive does not have expected plugin type in 'types' directive.",
      );
    });
  });
});
