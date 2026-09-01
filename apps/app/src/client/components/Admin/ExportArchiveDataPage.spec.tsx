import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { IExportStatus } from '~/stores/admin/export';

import ExportArchiveDataPage from './ExportArchiveDataPage';

// --- module mocks -----------------------------------------------------------

const useAdminSocket = vi.hoisted(() => vi.fn());
vi.mock('~/features/admin/states/socket-io', () => ({ useAdminSocket }));

const apiv3Get = vi.hoisted(() => vi.fn());
vi.mock('~/client/util/apiv3-client', () => ({ apiv3Get }));

const apiDelete = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());
vi.mock('~/client/util/apiv1-client', () => ({ apiDelete, apiPost }));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock('~/client/util/toastr', () => ({ toastSuccess, toastError }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// --- helpers ----------------------------------------------------------------

// The single source of truth the server would derive the archive list from
// (its filesystem). Tests mutate this to simulate exports completing / files
// being deleted, then let the component revalidate against it.
let serverStatus: IExportStatus;

const socketHandlers = new Map<string, (payload: unknown) => void>();

const makeStat = (fileName: string) => ({
  fileName,
  meta: { version: '7.5.7', exportedAt: '2026-07-23T00:00:00.000Z' },
  innerFileStats: [{ collectionName: 'pages' }],
});

const renderPage = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ExportArchiveDataPage />
    </SWRConfig>,
  );

// Number of archive rows currently shown (total <tr> minus the header row).
const archiveRowCount = () => screen.getAllByRole('row').length - 1;

const fireSocketEvent = async (event: string, payload: unknown) => {
  await act(async () => {
    socketHandlers.get(event)?.(payload);
  });
};

describe('ExportArchiveDataPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    socketHandlers.clear();

    serverStatus = {
      zipFileStats: [makeStat('growi-a.zip')],
      isExporting: false,
      progressList: null,
    };

    apiv3Get.mockImplementation((endpoint: string) => {
      if (endpoint === '/mongo/collections') {
        return Promise.resolve({ data: { collections: ['pages', 'users'] } });
      }
      if (endpoint === '/export/status') {
        return Promise.resolve({ data: { status: serverStatus } });
      }
      return Promise.reject(new Error(`unexpected endpoint: ${endpoint}`));
    });

    const socket = mock<Socket>();
    // socket.io's on() is heavily overloaded; a capturing implementation cannot
    // be expressed through those overload types, so cast this single function.
    socket.on.mockImplementation(((event: string, cb: (p: unknown) => void) => {
      socketHandlers.set(event, cb);
      return socket;
    }) as unknown as typeof socket.on);
    useAdminSocket.mockReturnValue(socket);
  });

  it('renders one row per archive reported by the server', async () => {
    renderPage();

    expect(await screen.findByText('growi-a.zip')).toBeInTheDocument();
    expect(archiveRowCount()).toBe(1);
  });

  it('shows exactly one row per archive after a completion event, even if it is processed twice (#11509)', async () => {
    // Contract: the displayed list always equals the server's archive list, so
    // a completion event that is (re-)processed more than once can never
    // produce duplicate rows. Regression guarded: the old handler appended the
    // event payload to local state without dedup, so a re-subscribed / doubled
    // event added the same archive twice, and deleting one row removed both.
    renderPage();
    await screen.findByText('growi-a.zip');

    // a new export finishes and lands on the server
    serverStatus = {
      ...serverStatus,
      zipFileStats: [makeStat('growi-a.zip'), makeStat('growi-b.zip')],
    };

    await fireSocketEvent('admin:onTerminateForExport', {
      addedZipFileStat: makeStat('growi-b.zip'),
    });
    await waitFor(() =>
      expect(screen.getByText('growi-b.zip')).toBeInTheDocument(),
    );

    // the same completion event is delivered again (double subscription)
    await fireSocketEvent('admin:onTerminateForExport', {
      addedZipFileStat: makeStat('growi-b.zip'),
    });

    await waitFor(() => expect(archiveRowCount()).toBe(2));
    expect(screen.getAllByText('growi-b.zip')).toHaveLength(1);
  });

  it('does not crash when a completion event carries a null stat (broken zip)', async () => {
    // The server emits a null stat for a broken zip; the listener must not
    // dereference it. Regression guarded: reading addedZipFileStat.fileName
    // threw inside the state updater / success toast.
    renderPage();
    await screen.findByText('growi-a.zip');

    await fireSocketEvent('admin:onTerminateForExport', {
      addedZipFileStat: null,
    });

    expect(screen.getByText('growi-a.zip')).toBeInTheDocument();
    expect(archiveRowCount()).toBe(1);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('removes only the deleted archive by re-syncing with the server', async () => {
    // Contract: deletion reflects the server's post-delete filesystem, not a
    // client-side filter by fileName (which would drop every entry sharing the
    // name). Here two distinct archives exist and deleting one leaves the other.
    serverStatus = {
      ...serverStatus,
      zipFileStats: [makeStat('growi-a.zip'), makeStat('growi-b.zip')],
    };
    apiDelete.mockImplementation(() => {
      serverStatus = {
        ...serverStatus,
        zipFileStats: [makeStat('growi-b.zip')],
      };
      return Promise.resolve();
    });

    renderPage();
    await screen.findByText('growi-a.zip');

    // the delete button of the first row (growi-a.zip)
    fireEvent.click(
      screen.getAllByRole('button', {
        name: /export_management\.delete/,
      })[0],
    );

    await waitFor(() =>
      expect(screen.queryByText('growi-a.zip')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('growi-b.zip')).toBeInTheDocument();
    expect(apiDelete).toHaveBeenCalledWith('/v3/export/growi-a.zip', {});
  });
});
