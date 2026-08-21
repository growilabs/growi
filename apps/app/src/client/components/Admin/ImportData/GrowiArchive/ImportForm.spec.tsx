import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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

    // The Import button only opens the notice about maintenance mode; nothing is sent
    // until the operator acknowledges it (requirement 2.10).
    fireEvent.click(importButton());
    expect(apiv3Post).not.toHaveBeenCalled();

    // trigger the (failing) import
    fireEvent.click(
      screen.getByRole('button', {
        name: 'maintenance_mode_notice.proceed',
      }),
    );

    // the button must become usable again once the failure is handled
    await waitFor(() => expect(importButton()).toBeEnabled());
    expect(apiv3Post).toHaveBeenCalledWith('/import', expect.any(Object));
  });

  it('does not import when the maintenance mode notice is dismissed', async () => {
    // Requirement 2.10 — the operator has to be able to back out after reading that
    // GROWI will be left closed.
    renderForm();

    fireEvent.click(
      screen.getByRole('button', {
        name: /export_management\.check_all/,
      }),
    );
    await waitFor(() => expect(importButton()).toBeEnabled());

    fireEvent.click(importButton());
    fireEvent.click(
      screen.getByRole('button', {
        name: 'maintenance_mode_notice.cancel',
      }),
    );

    expect(apiv3Post).not.toHaveBeenCalled();
  });

  it('still offers all three import methods for a collection the G2G screen narrows to two (this screen is out of scope for that narrowing)', () => {
    // Requirement 1.4 restricts choices only on the G2G screen
    // (G2GDataTransferExportForm.spec.tsx pins the narrowed side of this same
    // contract for `usergroups`). This manual zip import screen shares
    // ImportCollectionItem but never passes it `allowedModes`, so it must keep
    // offering "Flush and Insert" here.
    render(
      <ImportFormWrapperFc
        fileName="archive.zip"
        innerFileStats={[
          {
            fileName: 'usergroups.json',
            collectionName: 'usergroups',
            size: 1,
          },
        ]}
        onDiscard={vi.fn()}
      />,
    );

    const card = screen
      .getByLabelText('usergroups')
      .closest('.card') as HTMLElement | null;
    if (card == null) {
      throw new Error('Expected a .card ancestor for usergroups');
    }
    // The dropdown starts closed; its menu is still in the DOM but aria-hidden,
    // so `{ hidden: true }` is needed to find it by role.
    const menu = within(card).getByRole('menu', { hidden: true });

    expect(within(menu).getByText('Insert')).toBeInTheDocument();
    expect(within(menu).getByText('Upsert')).toBeInTheDocument();
    expect(within(menu).getByText('Flush and Insert')).toBeInTheDocument();
  });
});
