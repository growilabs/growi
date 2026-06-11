import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';

import { getUploader } from './index';

const mocks = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
}));

vi.mock('../config-manager', () => ({
  configManager: { getConfig: mocks.getConfigMock },
}));

// `default: undefined` keeps the `mod.default ?? mod.setup` fallback reachable —
// vitest mock modules throw on access to exports that are not defined at all.
vi.mock('./local', () => ({
  default: undefined,
  setup: vi.fn(() => ({ uploaderType: 'local' })),
}));

vi.mock('./none', () => ({
  default: undefined,
  setup: vi.fn(() => ({ uploaderType: 'none' })),
}));

describe('getUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the uploader for the currently configured fileUploadType', async () => {
    const crowi = mock<Crowi>();
    mocks.getConfigMock.mockReturnValue('local');

    const uploader = await getUploader(crowi);

    expect(uploader).toMatchObject({ uploaderType: 'local' });
  });

  // Contract relied on by Crowi.setUpFileUpload(isForceUpdate=true)
  // (routes/apiv3/app-settings/file-upload-setting.ts, service/file-uploader-switch.ts,
  // service/g2g-transfer.ts): after app:fileUploadType changes, the next call
  // must return an uploader for the NEW type, not a stale instance.
  it('reflects a changed fileUploadType on the next call', async () => {
    const crowi = mock<Crowi>();
    mocks.getConfigMock.mockReturnValue('local');
    await getUploader(crowi);

    mocks.getConfigMock.mockReturnValue('none');
    const uploader = await getUploader(crowi);

    expect(uploader).toMatchObject({ uploaderType: 'none' });
  });
});
