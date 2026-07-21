import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import ImportFormWrapperFc from './ImportForm';

// --- module mocks -----------------------------------------------------------

const useAdminSocket = vi.hoisted(() => vi.fn());
vi.mock('~/features/admin/states/socket-io', () => ({ useAdminSocket }));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const apiv3Post = vi.hoisted(() => vi.fn());
vi.mock('~/client/util/apiv3-client', () => ({ apiv3Post }));

vi.mock('~/client/util/toastr', () => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

// --- helpers ----------------------------------------------------------------

const renderForm = () =>
  render(
    <ImportFormWrapperFc
      fileName="archive.zip"
      innerFileStats={[
        { fileName: 'tags.json', collectionName: 'tags', size: 1 },
      ]}
      onDiscard={vi.fn()}
    />,
  );

const importButton = () =>
  screen.getByRole('button', { name: 'admin:importer_management.import' });

describe('ImportFormWrapperFc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // socket must be non-null so the actual ImportForm renders; its event
    // handlers are irrelevant to these tests, so an auto-stubbed mock is enough.
    useAdminSocket.mockReturnValue(mock<Socket>());
  });

  it('renders nothing (no crash) while the admin socket is not yet initialised', () => {
    useAdminSocket.mockReturnValue(null);
    const { container } = renderForm();
    expect(container).toBeEmptyDOMElement();
  });

  it('re-enables the Import button after a failed import so the user can retry', async () => {
    // Contract: when the import request fails, the form must return to an
    // importable state. Regression guarded: the button staying disabled
    // forever because isImporting was never reset in the catch block.
    apiv3Post.mockRejectedValue(new Error('network down'));

    renderForm();

    // select a collection so the form becomes importable
    // (the button label is prefixed by a material-symbols icon glyph, so match loosely)
    fireEvent.click(
      screen.getByRole('button', {
        name: /export_management\.check_all/,
      }),
    );
    await waitFor(() => expect(importButton()).toBeEnabled());

    // trigger the (failing) import
    fireEvent.click(importButton());

    // the button must become usable again once the failure is handled
    await waitFor(() => expect(importButton()).toBeEnabled());
    expect(apiv3Post).toHaveBeenCalledWith('/import', expect.any(Object));
  });
});
