import type { JSX, ReactNode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';

import { SocketEventName } from '~/interfaces/websocket';

import type {
  BacklinksBackfillProgressData,
  BacklinksBackfillState,
} from '../../interfaces/page-link-backfill';
import { BacklinksBackfillAdmin } from './BacklinksBackfillAdmin';

const mocks = vi.hoisted(() => ({
  apiv3Get: vi.fn(),
  apiv3Post: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  useAdminSocket: vi.fn(),
}));

// Echoes interpolation values so a test can see what the text was given.
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params == null ? key : `${key} ${JSON.stringify(params)}`,
  }),
}));
vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: mocks.apiv3Get,
  apiv3Post: mocks.apiv3Post,
}));
vi.mock('~/client/util/toastr', () => ({
  toastError: mocks.toastError,
  toastSuccess: mocks.toastSuccess,
}));
vi.mock('~/features/admin/states/socket-io', () => ({
  useAdminSocket: mocks.useAdminSocket,
}));

const K = 'admin:backlinks_backfill';

// Midday UTC, so the dates read as the same day in any time zone.
const COVERED_SINCE = '2026-03-01T12:00:00.000Z';
const RETRY_AT = '2026-03-02T12:00:00.000Z';
const COMPLETED_AT = '2026-03-03T12:00:00.000Z';

const stateOf = (
  overrides: Partial<BacklinksBackfillState> = {},
): BacklinksBackfillState => ({
  status: 'idle',
  stopRequested: false,
  processed: 0,
  runTotal: null,
  skippedPages: 0,
  coverage: 'none',
  coveredSince: null,
  completedAt: null,
  lastError: null,
  failedAttempts: 0,
  retryAt: null,
  notIncludedCount: 0,
  totalPageCount: 1234,
  ...overrides,
});

const RUNNING = stateOf({ status: 'running', processed: 10, runTotal: 100 });

/** The admin socket as the server drives it: `serverEmit` reaches every listener still on. */
const createFakeSocket = () => {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  return {
    on: vi.fn((event: string, listener: (data: unknown) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    }),
    off: vi.fn((event: string, listener: (data: unknown) => void) => {
      listeners.get(event)?.delete(listener);
    }),
    serverEmit: (event: string, data: unknown) => {
      for (const listener of listeners.get(event) ?? []) listener(data);
    },
  };
};

const emitProgress = (
  socket: ReturnType<typeof createFakeSocket>,
  data: BacklinksBackfillProgressData,
) =>
  act(() => {
    socket.serverEmit(SocketEventName.BacklinksBackfillProgress, data);
  });

const respondWith = (state: BacklinksBackfillState) => ({ data: { state } });

/** First read answers `state`; later reads never settle, so only the socket can move the view. */
const serveOnceThenHang = (state: BacklinksBackfillState) => {
  mocks.apiv3Get
    .mockResolvedValueOnce(respondWith(state))
    .mockReturnValue(new Promise(() => {}));
};

const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

const renderAdmin = () => render(<BacklinksBackfillAdmin />, { wrapper });

const button = (name: string) => screen.queryByRole('button', { name });
const START = `${K}.start`;
const STOP = `${K}.stop`;
const RESUME = `${K}.resume`;

describe('BacklinksBackfillAdmin', () => {
  let socket: ReturnType<typeof createFakeSocket>;

  beforeEach(() => {
    vi.clearAllMocks();
    socket = createFakeSocket();
    mocks.useAdminSocket.mockReturnValue(socket);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('states (design.md, "Admin settings (what the admin sees)")', () => {
    it('not started: says so with the page count, and offers the scope and Start', async () => {
      mocks.apiv3Get.mockResolvedValue(respondWith(stateOf()));

      renderAdmin();

      const status = await screen.findByTestId('backfill-status');
      expect(status).toHaveTextContent(`${K}.not_started`);
      expect(status).toHaveTextContent('"pages":1234');
      expect(button(START)).toBeEnabled();
      expect(screen.getByLabelText(`${K}.scope_all`)).toBeInTheDocument();
      expect(button(STOP)).not.toBeInTheDocument();
      expect(button(RESUME)).not.toBeInTheDocument();
    });

    it('running: shows processed of runTotal with a percent, Stop, and a disabled Start', async () => {
      mocks.apiv3Get.mockResolvedValue(respondWith(RUNNING));

      renderAdmin();

      const progress = await screen.findByTestId('backfill-progress');
      expect(progress).toHaveTextContent('"processed":10');
      expect(progress).toHaveTextContent('"total":100');
      expect(progress).toHaveTextContent('"percent":10');
      expect(button(STOP)).toBeEnabled();
      expect(button(START)).toBeDisabled();
      expect(button(RESUME)).not.toBeInTheDocument();
    });

    it('running: shows skipped pages as their own count', async () => {
      mocks.apiv3Get.mockResolvedValue(
        respondWith({ ...RUNNING, skippedPages: 3 }),
      );

      renderAdmin();

      expect(await screen.findByTestId('backfill-skipped')).toHaveTextContent(
        '"skipped":3',
      );
    });

    it('stopping: says "Stopping…" and offers no control', async () => {
      mocks.apiv3Get.mockResolvedValue(
        respondWith({ ...RUNNING, stopRequested: true }),
      );

      renderAdmin();

      expect(await screen.findByTestId('backfill-status')).toHaveTextContent(
        `${K}.stopping`,
      );
      expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('failed with a retry due: shows the error, when it retries and which retry, Stop and Resume, and a disabled Start', async () => {
      mocks.apiv3Get.mockResolvedValue(
        respondWith(
          stateOf({
            status: 'failed',
            lastError: 'connection lost',
            failedAttempts: 2,
            retryAt: RETRY_AT,
          }),
        ),
      );

      renderAdmin();

      const status = await screen.findByTestId('backfill-status');
      expect(status).toHaveTextContent('connection lost');
      expect(status).toHaveTextContent(`${K}.retry_at`);
      expect(status).toHaveTextContent('2026-03-02');
      expect(status).toHaveTextContent('"attempt":2');
      expect(status).toHaveTextContent('"max":3');
      expect(button(STOP)).toBeEnabled();
      expect(button(RESUME)).toBeEnabled();
      expect(button(START)).toBeDisabled();
    });

    it('failed with no retry due: shows the error and that it is not retried, Resume, and Start', async () => {
      mocks.apiv3Get.mockResolvedValue(
        respondWith(
          stateOf({
            status: 'failed',
            lastError: 'connection lost',
            failedAttempts: 4,
          }),
        ),
      );

      renderAdmin();

      const status = await screen.findByTestId('backfill-status');
      expect(status).toHaveTextContent('connection lost');
      expect(status).toHaveTextContent(`${K}.failed_no_retry`);
      expect(button(RESUME)).toBeEnabled();
      expect(button(START)).toBeEnabled();
      expect(button(STOP)).not.toBeInTheDocument();
    });

    it('stopped: shows where it stopped, Resume, and Start', async () => {
      mocks.apiv3Get.mockResolvedValue(
        respondWith(
          stateOf({ status: 'stopped', processed: 40, runTotal: 100 }),
        ),
      );

      renderAdmin();

      const status = await screen.findByTestId('backfill-status');
      expect(status).toHaveTextContent(`${K}.stopped`);
      expect(status).toHaveTextContent('"processed":40');
      expect(status).toHaveTextContent('"total":100');
      expect(button(RESUME)).toBeEnabled();
      expect(button(START)).toBeEnabled();
      expect(button(STOP)).not.toBeInTheDocument();
    });

    it('partial coverage: names the boundary and about how many of all pages are not included, and keeps Start', async () => {
      mocks.apiv3Get.mockResolvedValue(
        respondWith(
          stateOf({
            status: 'complete',
            coverage: 'partial',
            coveredSince: COVERED_SINCE,
            notIncludedCount: 321,
            totalPageCount: 1234,
          }),
        ),
      );

      renderAdmin();

      const status = await screen.findByTestId('backfill-status');
      expect(status).toHaveTextContent(`${K}.partial`);
      const [coveredSince, notIncluded] =
        within(status).getAllByRole('definition');
      expect(coveredSince).toHaveTextContent('2026-03-01');
      expect(notIncluded).toHaveTextContent('"pages":321');
      expect(notIncluded).toHaveTextContent('"total":1234');
      expect(button(START)).toBeEnabled();
      expect(screen.getByLabelText(`${K}.scope_all`)).toBeInTheDocument();
    });

    // design.md's table has no "complete" row: the coverage row shows, with the last run at 100%.
    it("after a completed run: shows the coverage line and the finished run's progress at 100%", async () => {
      mocks.apiv3Get.mockResolvedValue(
        respondWith(
          stateOf({
            status: 'complete',
            coverage: 'partial',
            coveredSince: COVERED_SINCE,
            processed: 150,
            runTotal: 150,
          }),
        ),
      );

      renderAdmin();

      expect(await screen.findByTestId('backfill-status')).toHaveTextContent(
        `${K}.partial`,
      );
      expect(screen.getByTestId('backfill-progress')).toHaveTextContent(
        '"percent":100',
      );
      expect(button(START)).toBeEnabled();
    });

    it('all pages covered: says so with the completion time and offers no control', async () => {
      mocks.apiv3Get.mockResolvedValue(
        respondWith(
          stateOf({
            status: 'complete',
            coverage: 'all',
            completedAt: COMPLETED_AT,
          }),
        ),
      );

      renderAdmin();

      const status = await screen.findByTestId('backfill-status');
      expect(status).toHaveTextContent(`${K}.all`);
      expect(status).toHaveTextContent('2026-03-03');
      expect(button(START)).not.toBeInTheDocument();
      expect(screen.queryAllByRole('button')).toHaveLength(0);
    });
  });

  describe('live progress', () => {
    it("updates a started run's progress from the admin socket, without a reload", async () => {
      serveOnceThenHang(RUNNING);
      renderAdmin();
      await screen.findByTestId('backfill-progress');

      emitProgress(socket, {
        status: 'running',
        processed: 50,
        runTotal: 100,
        skippedPages: 0,
      });

      const progress = screen.getByTestId('backfill-progress');
      expect(progress).toHaveTextContent('"processed":50');
      expect(progress).toHaveTextContent('"percent":50');
    });

    it('reads 99% with the count capped at runTotal while processed passes it, and 100% only once complete', async () => {
      serveOnceThenHang(
        stateOf({ status: 'running', processed: 160, runTotal: 150 }),
      );
      renderAdmin();

      const progress = await screen.findByTestId('backfill-progress');
      expect(progress).toHaveTextContent('"processed":150');
      expect(progress).toHaveTextContent('"percent":99');

      emitProgress(socket, {
        status: 'complete',
        processed: 165,
        runTotal: 150,
        skippedPages: 0,
      });

      const done = screen.getByTestId('backfill-progress');
      expect(done).toHaveTextContent('"processed":150');
      expect(done).toHaveTextContent('"percent":100');
    });

    // The event carries no coverage or completion time, so the state is read again.
    it('reads the job state again on a progress event, so a completed run shows its coverage', async () => {
      mocks.apiv3Get
        .mockResolvedValueOnce(respondWith(RUNNING))
        .mockResolvedValue(
          respondWith(
            stateOf({
              status: 'complete',
              coverage: 'all',
              completedAt: COMPLETED_AT,
              processed: 100,
              runTotal: 100,
            }),
          ),
        );
      renderAdmin();
      await screen.findByTestId('backfill-progress');

      emitProgress(socket, {
        status: 'complete',
        processed: 100,
        runTotal: 100,
        skippedPages: 0,
      });

      await waitFor(() =>
        expect(screen.getByTestId('backfill-status')).toHaveTextContent(
          `${K}.all`,
        ),
      );
    });

    // A failing run emits nothing, so an active run is re-read on an interval.
    it('notices a run that failed without an event', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mocks.apiv3Get
        .mockResolvedValueOnce(respondWith(RUNNING))
        .mockResolvedValue(
          respondWith(
            stateOf({ status: 'failed', lastError: 'db down', retryAt: null }),
          ),
        );
      renderAdmin();
      await screen.findByTestId('backfill-progress');

      await act(() => vi.advanceTimersByTimeAsync(30_000));

      await waitFor(() =>
        expect(screen.getByTestId('backfill-status')).toHaveTextContent(
          'db down',
        ),
      );
    });

    it('stops listening once unmounted', async () => {
      mocks.apiv3Get.mockResolvedValue(respondWith(RUNNING));
      const { unmount } = renderAdmin();
      await screen.findByTestId('backfill-progress');

      unmount();

      const [[event, listener]] = socket.on.mock.calls;
      expect(socket.off).toHaveBeenCalledWith(event, listener);
    });
  });

  describe('controls', () => {
    it('starts a run over the newest N pages and shows it running', async () => {
      const user = userEvent.setup();
      mocks.apiv3Get.mockResolvedValue(respondWith(stateOf()));
      mocks.apiv3Post.mockResolvedValue(
        respondWith(stateOf({ status: 'requested' })),
      );
      renderAdmin();
      await screen.findByTestId('backfill-status');

      await user.click(screen.getByLabelText(`${K}.scope_max_pages`));
      await user.type(screen.getByLabelText(`${K}.max_pages_label`), '500');
      await user.click(screen.getByRole('button', { name: START }));

      expect(mocks.apiv3Post).toHaveBeenCalledWith(
        '/backlinks-backfill/start',
        { kind: 'maxPages', maxPages: 500 },
      );
      await waitFor(() => expect(button(START)).toBeDisabled());
      expect(button(STOP)).toBeEnabled();
    });

    it('starts a run over all pages by default', async () => {
      const user = userEvent.setup();
      mocks.apiv3Get.mockResolvedValue(respondWith(stateOf()));
      mocks.apiv3Post.mockResolvedValue(
        respondWith(stateOf({ status: 'requested' })),
      );
      renderAdmin();
      await screen.findByTestId('backfill-status');

      await user.click(screen.getByRole('button', { name: START }));

      expect(mocks.apiv3Post).toHaveBeenCalledWith(
        '/backlinks-backfill/start',
        { kind: 'all' },
      );
    });

    it('explains, on the page count field, that N counts from the newest page', async () => {
      mocks.apiv3Get.mockResolvedValue(respondWith(stateOf()));
      renderAdmin();
      await screen.findByTestId('backfill-status');

      expect(
        screen.getByLabelText(`${K}.max_pages_label`),
      ).toHaveAccessibleDescription(`${K}.max_pages_hint`);
    });

    it('does not send an invalid scope, and says why', async () => {
      const user = userEvent.setup();
      mocks.apiv3Get.mockResolvedValue(respondWith(stateOf()));
      renderAdmin();
      await screen.findByTestId('backfill-status');

      await user.click(screen.getByLabelText(`${K}.scope_max_pages`));
      await user.type(screen.getByLabelText(`${K}.max_pages_label`), '0');
      await user.click(screen.getByRole('button', { name: START }));

      expect(mocks.apiv3Post).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent(
        `${K}.invalid_max_pages`,
      );
    });

    it("shows the server's refusal with the toastr", async () => {
      const user = userEvent.setup();
      const refusal = [{ message: 'busy', code: 'backfill_run_active' }];
      mocks.apiv3Get.mockResolvedValue(respondWith(stateOf()));
      mocks.apiv3Post.mockRejectedValue(refusal);
      renderAdmin();
      await screen.findByTestId('backfill-status');

      await user.click(screen.getByRole('button', { name: START }));

      await waitFor(() =>
        expect(mocks.toastError).toHaveBeenCalledWith(refusal),
      );
    });

    it('asks a running run to stop and shows "Stopping…" at once', async () => {
      const user = userEvent.setup();
      serveOnceThenHang(RUNNING);
      mocks.apiv3Post.mockResolvedValue(
        respondWith({ ...RUNNING, stopRequested: true }),
      );
      renderAdmin();
      await screen.findByTestId('backfill-progress');

      await user.click(screen.getByRole('button', { name: STOP }));

      expect(mocks.apiv3Post).toHaveBeenCalledWith('/backlinks-backfill/stop');
      await waitFor(() =>
        expect(screen.getByTestId('backfill-status')).toHaveTextContent(
          `${K}.stopping`,
        ),
      );
    });

    it('resumes a stopped run', async () => {
      const user = userEvent.setup();
      mocks.apiv3Get.mockResolvedValue(
        respondWith(
          stateOf({ status: 'stopped', processed: 40, runTotal: 100 }),
        ),
      );
      mocks.apiv3Post.mockResolvedValue(
        respondWith(
          stateOf({ status: 'requested', processed: 40, runTotal: 100 }),
        ),
      );
      renderAdmin();
      await screen.findByTestId('backfill-status');

      await user.click(screen.getByRole('button', { name: RESUME }));

      expect(mocks.apiv3Post).toHaveBeenCalledWith(
        '/backlinks-backfill/resume',
      );
      await waitFor(() => expect(button(STOP)).toBeEnabled());
      expect(
        within(screen.getByTestId('backfill-progress')).getByText(
          /"processed":40/,
        ),
      ).toBeInTheDocument();
    });
  });
});
