import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';

import { ImportService } from './import';

const mocks = vi.hoisted(() => {
  return {
    constructConvertMapMock: vi.fn(),
    setupIndependentModelsMock: vi.fn(),
  };
});

vi.mock('~/server/crowi/setup-models', () => ({
  setupIndependentModels: mocks.setupIndependentModelsMock,
}));
vi.mock('./construct-convert-map', () => ({
  constructConvertMap: mocks.constructConvertMapMock,
}));

/**
 * Get private property from ImportService
 */
const getPrivateProperty = <T>(
  importService: ImportService,
  propertyName: string,
): T => {
  return importService[propertyName];
};

describe('ImportService', () => {
  let importService: ImportService;

  beforeAll(async () => {
    const crowiMock = mock<Crowi>({
      growiBridgeService: {
        getFile: vi.fn(),
      },
      tmpDir: '/tmp',
    });

    importService = new ImportService(crowiMock);
  });

  describe('preImport', () => {
    test('should call setupIndependentModels', async () => {
      // arrange
      const convertMapMock = mock();
      mocks.constructConvertMapMock.mockImplementation(() => convertMapMock);

      // act
      await importService.preImport();

      // assert
      expect(mocks.setupIndependentModelsMock).toHaveBeenCalledOnce();
      expect(mocks.constructConvertMapMock).toHaveBeenCalledOnce();
      expect(getPrivateProperty(importService, 'convertMap')).toStrictEqual(
        convertMapMock,
      );
    });
  });
});
