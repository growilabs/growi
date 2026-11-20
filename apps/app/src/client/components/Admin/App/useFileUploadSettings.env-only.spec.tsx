import { renderHook, waitFor } from '@testing-library/react';

import { useFileUploadSettings } from './useFileUploadSettings';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: get,
  apiv3Put: vi.fn(),
}));

describe('storage environment-only flags', () => {
  it('passes all provider locks from the API to the form data', async () => {
    get.mockResolvedValue({
      data: {
        appSettingsParams: {
          fileUploadType: 'aws',
          awsUseOnlyEnvVars: true,
          gcsUseOnlyEnvVars: true,
          azureUseOnlyEnvVars: true,
        },
      },
    });
    const { result } = renderHook(useFileUploadSettings);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.data).toMatchObject({
      awsUseOnlyEnvVars: true,
      gcsUseOnlyEnvVars: true,
      azureUseOnlyEnvVars: true,
    });
  });

  it('keeps provider settings editable when the API omits the flags', async () => {
    get.mockResolvedValue({
      data: { appSettingsParams: { fileUploadType: 'aws' } },
    });
    const { result } = renderHook(useFileUploadSettings);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toMatchObject({
      awsUseOnlyEnvVars: false,
      gcsUseOnlyEnvVars: false,
      azureUseOnlyEnvVars: false,
    });
  });
});
