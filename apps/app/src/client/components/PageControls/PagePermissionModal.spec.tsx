import { PageWriteGrant } from '@growi/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mock } from 'vitest-mock-extended';

import { PagePermissionModal } from './PagePermissionModal';

const mocks = vi.hoisted(() => ({
  apiv3PutMock: vi.fn(),
}));

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Put: mocks.apiv3PutMock,
}));

vi.mock('~/client/util/toastr', () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('~/stores/page', () => ({
  useSWRxCurrentGrantData: vi.fn(),
}));

import { useSWRxCurrentGrantData } from '~/stores/page';

describe('PagePermissionModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize writeGrant from currentGrantData', () => {
    const currentGrantData = {
      isGrantNormalized: true,
      grantData: {
        isForbidden: false,
        currentPageGrant: {
          grant: 1,
          groupGrantData: {
            userRelatedGroups: [],
            nonUserRelatedGrantedGroups: [],
          },
        },
        currentPageWriteGrant: {
          writeGrant: PageWriteGrant.WRITE_GRANT_OWNER,
          groupGrantData: {
            userRelatedGroups: [],
            nonUserRelatedGrantedGroups: [],
          },
        },
        parentPageGrant: null,
      },
    };
    (useSWRxCurrentGrantData as any).mockReturnValue({
      data: currentGrantData,
    });

    render(<PagePermissionModal isOpen pageId="page-id" onClose={() => {}} />);

    expect(screen.getByLabelText(/write_grant.owner/i)).toBeChecked();
    expect(screen.getByLabelText(/write_grant.public/i)).not.toBeChecked();
  });

  it('should call apiv3Put with selected grants when saving', async () => {
    const currentGrantData = {
      isGrantNormalized: true,
      grantData: {
        isForbidden: false,
        currentPageGrant: {
          grant: 1,
          groupGrantData: {
            userRelatedGroups: [],
            nonUserRelatedGrantedGroups: [],
          },
        },
        currentPageWriteGrant: {
          writeGrant: PageWriteGrant.WRITE_GRANT_PUBLIC,
          groupGrantData: {
            userRelatedGroups: [],
            nonUserRelatedGrantedGroups: [],
          },
        },
        parentPageGrant: null,
      },
    };
    (useSWRxCurrentGrantData as any).mockReturnValue({
      data: currentGrantData,
    });

    mocks.apiv3PutMock.mockResolvedValue({});

    render(<PagePermissionModal isOpen pageId="page-id" onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText(/write_grant.owner/i));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mocks.apiv3PutMock).toHaveBeenCalledWith(
        '/page/page-id/write-grant',
        expect.objectContaining({
          writeGrant: PageWriteGrant.WRITE_GRANT_OWNER,
        }),
      );
    });
  });
});
