// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import { createElement } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
// biome-ignore lint/style/noRestrictedImports: import only types
import type { AxiosResponse } from 'axios';
import { SWRConfig } from 'swr';
import { vi } from 'vitest';

import * as apiv3Client from '~/client/util/apiv3-client';

import type {
  AiSettingsResponse,
  AiSettingsUpdateRequest,
} from '../../interfaces/ai-settings';
import { useAiSettings } from './use-ai-settings';

vi.mock('~/client/util/apiv3-client');
const mockedApiv3Get = vi.spyOn(apiv3Client, 'apiv3Get');
const mockedApiv3Put = vi.spyOn(apiv3Client, 'apiv3Put');

const buildResponse = <T>(data: T): AxiosResponse<T> => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
  config: {} as AxiosResponse['config'],
});

const baseSettings: AiSettingsResponse = {
  aiEnabled: true,
  provider: 'openai',
  allowedModels: [{ modelId: 'gpt-4o', isDefault: true }],
  azureOpenaiSettings: {},
  isApiKeySet: true,
  useOnlyEnvVars: false,
  isConfigured: true,
};

// Fresh SWR cache per render so subscriptions never leak between tests.
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    children,
  );

const renderUseAiSettings = () =>
  renderHook(() => useAiSettings(), { wrapper });

describe('useAiSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApiv3Get.mockResolvedValue(buildResponse(baseSettings));
    mockedApiv3Put.mockResolvedValue(buildResponse(baseSettings));
  });

  describe('fetch', () => {
    it('subscribes to GET /ai-settings and returns the response body', async () => {
      // Act
      const { result } = renderUseAiSettings();

      // Assert
      await waitFor(() => {
        expect(result.current.data).toEqual(baseSettings);
      });
      expect(mockedApiv3Get).toHaveBeenCalledWith('/ai-settings');
    });
  });

  describe('save', () => {
    it('calls PUT /ai-settings with the request body', async () => {
      // Arrange
      const { result } = renderUseAiSettings();
      await waitFor(() => {
        expect(result.current.data).toEqual(baseSettings);
      });
      const body: AiSettingsUpdateRequest = {
        aiEnabled: true,
        provider: 'anthropic',
        allowedModels: [{ modelId: 'claude-3-5-sonnet', isDefault: true }],
      };

      // Act
      await act(async () => {
        await result.current.save(body);
      });

      // Assert
      expect(mockedApiv3Put).toHaveBeenCalledWith('/ai-settings', body);
    });

    it('revalidates the fetched settings after a successful save', async () => {
      // Arrange
      mockedApiv3Get.mockResolvedValueOnce(buildResponse(baseSettings));
      const { result } = renderUseAiSettings();
      await waitFor(() => {
        expect(result.current.data).toEqual(baseSettings);
      });

      // The PUT returns the updated state; the subsequent revalidation GET
      // should surface that updated state through the hook's data.
      const updatedSettings: AiSettingsResponse = {
        ...baseSettings,
        provider: 'google',
        allowedModels: [{ modelId: 'gemini-1.5-pro', isDefault: true }],
      };
      mockedApiv3Get.mockResolvedValue(buildResponse(updatedSettings));

      const getCallsBeforeSave = mockedApiv3Get.mock.calls.length;

      // Act
      await act(async () => {
        await result.current.save({ provider: 'google' });
      });

      // Assert: revalidation re-fetches and the hook reflects the new data
      await waitFor(() => {
        expect(mockedApiv3Get.mock.calls.length).toBeGreaterThan(
          getCallsBeforeSave,
        );
      });
      await waitFor(() => {
        expect(result.current.data).toEqual(updatedSettings);
      });
    });

    it('propagates the error to the caller when the save fails', async () => {
      // Arrange
      const { result } = renderUseAiSettings();
      await waitFor(() => {
        expect(result.current.data).toEqual(baseSettings);
      });
      const saveError = new Error('update failed');
      mockedApiv3Put.mockRejectedValueOnce(saveError);

      // Act & Assert: the hook does not swallow the error (toast/state
      // handling is the container's responsibility).
      await act(async () => {
        await expect(result.current.save({ aiEnabled: false })).rejects.toBe(
          saveError,
        );
      });
    });
  });
});
