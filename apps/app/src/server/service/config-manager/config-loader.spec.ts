import type { RawConfigData } from '@growi/core/dist/interfaces';

import type { ConfigKey, ConfigValues } from './config-definition';
import { ConfigLoader } from './config-loader';

const mockExec = vi.fn();
const mockFind = vi.fn().mockReturnValue({ exec: mockExec });

// Mock the Config model
vi.mock('../../models/config', () => ({
  Config: {
    find: mockFind,
  },
}));

describe('ConfigLoader', () => {
  let configLoader: ConfigLoader;

  beforeEach(async () => {
    configLoader = new ConfigLoader();
    vi.clearAllMocks();
  });

  describe('loadFromDB', () => {
    describe('when doc.value is empty string', () => {
      beforeEach(() => {
        const mockDocs = [
          { key: 'app:referrerPolicy' as ConfigKey, value: '' },
        ];
        mockExec.mockResolvedValue(mockDocs);
      });

      it('should return null for value', async () => {
        const config: RawConfigData<ConfigKey, ConfigValues> =
          await configLoader.loadFromDB();
        expect(config['app:referrerPolicy'].value).toBe(null);
      });
    });

    describe('when doc.value is invalid JSON', () => {
      beforeEach(() => {
        const mockDocs = [
          { key: 'app:referrerPolicy' as ConfigKey, value: '{invalid:json' },
        ];
        mockExec.mockResolvedValue(mockDocs);
      });

      it('should return null for value', async () => {
        const config: RawConfigData<ConfigKey, ConfigValues> =
          await configLoader.loadFromDB();
        expect(config['app:referrerPolicy'].value).toBe(null);
      });
    });

    describe('when doc.value is valid JSON', () => {
      const validJson = { key: 'value' };
      beforeEach(() => {
        const mockDocs = [
          {
            key: 'app:referrerPolicy' as ConfigKey,
            value: JSON.stringify(validJson),
          },
        ];
        mockExec.mockResolvedValue(mockDocs);
      });

      it('should return parsed value', async () => {
        const config: RawConfigData<ConfigKey, ConfigValues> =
          await configLoader.loadFromDB();
        expect(config['app:referrerPolicy'].value).toEqual(validJson);
      });
    });

    describe('when doc.value is null', () => {
      beforeEach(() => {
        const mockDocs = [
          { key: 'app:referrerPolicy' as ConfigKey, value: null },
        ];
        mockExec.mockResolvedValue(mockDocs);
      });

      it('should return null for value', async () => {
        const config: RawConfigData<ConfigKey, ConfigValues> =
          await configLoader.loadFromDB();
        expect(config['app:referrerPolicy'].value).toBe(null);
      });
    });
  });
});
