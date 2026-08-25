/**
 * FileUploadSetting.spec.tsx
 *
 * Regression test for PR #10941: the update button was hidden entirely
 * on GROWI.cloud (`{!isCloud && <AdminUpdateButtonRow ... />}`), even though
 * cloud admins can still edit fields that are not cloud-managed (e.g. the
 * GCS/Azure file delivery relay-mode dropdown) and need a way to save them.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    growiCloudUri: undefined as string | undefined,
    growiAppIdForGrowiCloud: undefined as number | undefined,
  };
});

vi.mock('~/states/global', () => ({
  useGrowiCloudUri: () => mocks.growiCloudUri,
  useGrowiAppIdForGrowiCloud: () => mocks.growiAppIdForGrowiCloud,
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('./useFileUploadSettings', () => ({
  useFileUploadSettings: () => ({
    data: {
      fileUploadType: 'gcs',
      isFixedFileUploadByEnvVar: false,
      s3Region: '',
      s3CustomEndpoint: '',
      s3Bucket: '',
      s3AccessKeyId: '',
      s3SecretAccessKey: '',
      s3ReferenceFileWithRelayMode: false,
      gcsApiKeyJsonPath: '',
      gcsBucket: '',
      gcsUploadNamespace: '',
      gcsReferenceFileWithRelayMode: false,
      gcsUseOnlyEnvVars: false,
      azureTenantId: '',
      azureClientId: '',
      azureClientSecret: '',
      azureStorageAccountName: '',
      azureStorageContainerName: '',
      azureReferenceFileWithRelayMode: false,
      azureUseOnlyEnvVars: false,
    },
    isLoading: false,
    error: null,
    updateSettings: vi.fn(),
  }),
}));

import FileUploadSetting from './FileUploadSetting';

describe('FileUploadSetting', () => {
  it('renders the update button when not on GROWI.cloud', () => {
    mocks.growiCloudUri = undefined;
    mocks.growiAppIdForGrowiCloud = undefined;

    render(<FileUploadSetting />);

    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
  });

  it('still renders the update button on GROWI.cloud, so cloud-editable fields (e.g. relay mode) can be saved', () => {
    mocks.growiCloudUri = 'https://growi.cloud';
    mocks.growiAppIdForGrowiCloud = 123;

    render(<FileUploadSetting />);

    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
  });
});
