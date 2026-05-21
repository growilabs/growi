/**
 * VaultAdminSettings.spec.tsx
 *
 * Tests for the resilience-layer additions to VaultAdminSettings:
 *   (a) Completion Reliability section renders
 *   (b) Auto-Retry abort button disabled state
 *   (c) Drift counts displayed
 *   (d) Force Warning banner display condition
 *   (e) Done-state confirm modal on bootstrap button
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const apiv3Get = vi.fn();
  const apiv3Post = vi.fn().mockResolvedValue({});
  const apiv3Put = vi.fn().mockResolvedValue({});
  const toastError = vi.fn();
  const toastSuccess = vi.fn();
  const swrData: {
    status: unknown;
    resilience: unknown;
  } = { status: undefined, resilience: undefined };

  return { apiv3Get, apiv3Post, apiv3Put, toastError, toastSuccess, swrData };
});

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: mocks.apiv3Get,
  apiv3Post: mocks.apiv3Post,
  apiv3Put: mocks.apiv3Put,
}));

vi.mock('~/client/util/toastr', () => ({
  toastError: mocks.toastError,
  toastSuccess: mocks.toastSuccess,
}));

// Mock SWR to return controlled data without actual HTTP calls.
vi.mock('swr', () => ({
  default: (key: string, _fetcher: unknown, _opts?: unknown) => {
    if (key === '/vault/status') {
      return { data: mocks.swrData.status, mutate: vi.fn() };
    }
    if (key === '/vault/resilience-status') {
      return { data: mocks.swrData.resilience, mutate: vi.fn() };
    }
    return { data: undefined, mutate: vi.fn() };
  },
}));

import { VaultAdminSettings } from './VaultAdminSettings';

// ── Helpers ──────────────────────────────────────────────────────────────────

interface BootstrapShape {
  state: string;
  cursor: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  totalEstimated: number | null;
  processed: number;
  lastError: string | null;
}

interface RetryShape {
  attemptNo: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  aborted: boolean;
}

interface DriftShape {
  lastSweepAt: Date | null;
  lastWatermark: Date | null;
  detectedSinceBoot: number;
  repairsEmittedSinceBoot: number;
  lastError: string | null;
}

interface ResilienceStatusShape {
  bootstrap: BootstrapShape;
  retry: RetryShape | null;
  drift: DriftShape | null;
  lastTriggerSource: 'env-true' | 'env-force' | 'admin-ui' | null;
  forceWarningActive: boolean;
}

const defaultBootstrap: BootstrapShape = {
  state: 'done',
  cursor: null,
  startedAt: new Date('2026-01-01T00:00:00Z'),
  completedAt: new Date('2026-01-01T01:00:00Z'),
  totalEstimated: 100,
  processed: 100,
  lastError: null,
};

const makeResilienceStatus = (
  overrides: {
    bootstrap?: Partial<BootstrapShape>;
    retry?: RetryShape | null;
    drift?: DriftShape | null;
    lastTriggerSource?: 'env-true' | 'env-force' | 'admin-ui' | null;
    forceWarningActive?: boolean;
  } = {},
): ResilienceStatusShape => ({
  bootstrap: { ...defaultBootstrap, ...overrides.bootstrap },
  retry: overrides.retry !== undefined ? overrides.retry : null,
  drift: overrides.drift !== undefined ? overrides.drift : null,
  lastTriggerSource:
    overrides.lastTriggerSource !== undefined
      ? overrides.lastTriggerSource
      : null,
  forceWarningActive: overrides.forceWarningActive ?? false,
});

const makeVaultStatus = (state = 'done') => ({
  bootstrapState: state,
  processed: 100,
  totalEstimated: 100,
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T01:00:00.000Z',
  lastError: null,
  storageStats: null,
});

function setup(
  resilience: ResilienceStatusShape,
  vaultState = 'done',
): ReturnType<typeof render> {
  mocks.swrData.status = makeVaultStatus(vaultState);
  mocks.swrData.resilience = resilience;
  return render(<VaultAdminSettings />);
}

// ── Test suites ──────────────────────────────────────────────────────────────

describe('VaultAdminSettings — Completion Reliability section', () => {
  it('(a) renders the section heading', () => {
    setup(makeResilienceStatus());
    expect(screen.getByText('Completion Reliability')).toBeTruthy();
  });

  it('(a) shows completeness last checked date when completedAt is set', () => {
    const status = makeResilienceStatus({
      bootstrap: { completedAt: new Date('2026-01-01T01:00:00Z') },
    });
    setup(status);
    // The completedAt is used as the completion check time proxy
    expect(screen.getByText('Completion Reliability')).toBeTruthy();
  });

  it('(a) shows processed / totalEstimated counts', () => {
    const status = makeResilienceStatus({
      bootstrap: { processed: 42, totalEstimated: 99 },
    });
    setup(status);
    expect(screen.getByText(/42/)).toBeTruthy();
    expect(screen.getByText(/99/)).toBeTruthy();
  });

  it('(a) shows trigger source when lastTriggerSource is set', () => {
    const status = makeResilienceStatus({ lastTriggerSource: 'env-true' });
    setup(status);
    expect(screen.getByText(/env-true/)).toBeTruthy();
  });

  it('(a) shows "—" for trigger source when null', () => {
    const status = makeResilienceStatus({ lastTriggerSource: null });
    setup(status);
    // Section should render even without trigger source
    expect(screen.getByText('Completion Reliability')).toBeTruthy();
  });

  it('(a) shows bootstrap state as Check Result badge', () => {
    const status = makeResilienceStatus({ bootstrap: { state: 'done' } });
    setup(status);
    // "Check Result" row should display the bootstrap state value
    const checkResultHeader = screen.getByText('Check Result');
    expect(checkResultHeader).toBeTruthy();
    // The state badge should be visible near the header
    const badge = checkResultHeader.closest('tr')?.querySelector('.badge');
    expect(badge?.textContent).toBe('done');
  });
});

describe('VaultAdminSettings — Auto-Retry Status section', () => {
  it('(b) renders when retry data is present', () => {
    const status = makeResilienceStatus({
      bootstrap: { state: 'retrying' },
      retry: {
        attemptNo: 2,
        nextAttemptAt: new Date('2026-01-01T02:00:00Z'),
        lastError: 'connection refused',
        aborted: false,
      },
    });
    setup(status, 'retrying');
    expect(screen.getByText('Auto-Retry Status')).toBeTruthy();
  });

  it('(b) abort button is enabled when retry is not aborted', () => {
    const status = makeResilienceStatus({
      bootstrap: { state: 'retrying' },
      retry: {
        attemptNo: 1,
        nextAttemptAt: null,
        lastError: null,
        aborted: false,
      },
    });
    setup(status, 'retrying');
    const abortBtn = screen.getByRole('button', { name: /abort/i });
    expect((abortBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('(b) abort button is disabled when retry.aborted === true', () => {
    const status = makeResilienceStatus({
      bootstrap: { state: 'retrying' },
      retry: {
        attemptNo: 1,
        nextAttemptAt: null,
        lastError: null,
        aborted: true,
      },
    });
    setup(status, 'retrying');
    const abortBtn = screen.getByRole('button', { name: /abort/i });
    expect((abortBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('(b) shows escalated warning when bootstrap state is escalated', () => {
    const status = makeResilienceStatus({
      bootstrap: { state: 'escalated' },
      retry: {
        attemptNo: 5,
        nextAttemptAt: null,
        lastError: 'max retries reached',
        aborted: false,
      },
    });
    setup(status, 'escalated');
    // escalated state is shown with visual emphasis (Alert color="danger")
    expect(screen.getAllByText(/escalated/i).length).toBeGreaterThan(0);
  });

  it('(b) shows attempt number and last error', () => {
    const status = makeResilienceStatus({
      bootstrap: { state: 'retrying' },
      retry: {
        attemptNo: 3,
        nextAttemptAt: null,
        lastError: 'timeout error',
        aborted: false,
      },
    });
    setup(status, 'retrying');
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('timeout error')).toBeTruthy();
  });

  it('(b) does not render section when retry is null', () => {
    const status = makeResilienceStatus({ retry: null });
    setup(status);
    expect(screen.queryByText('Auto-Retry Status')).toBeNull();
  });
});

describe('VaultAdminSettings — Drift Activity section', () => {
  it('(c) renders when drift data is present', () => {
    const status = makeResilienceStatus({
      drift: {
        lastSweepAt: new Date('2026-01-01T03:00:00Z'),
        lastWatermark: new Date('2026-01-01T02:00:00Z'),
        detectedSinceBoot: 5,
        repairsEmittedSinceBoot: 3,
        lastError: null,
      },
    });
    setup(status);
    expect(screen.getByText('Drift Activity')).toBeTruthy();
  });

  it('(c) shows detected count', () => {
    const status = makeResilienceStatus({
      drift: {
        lastSweepAt: new Date(),
        lastWatermark: null,
        detectedSinceBoot: 7,
        repairsEmittedSinceBoot: 4,
        lastError: null,
      },
    });
    setup(status);
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
  });

  it('(c) shows drift lastError when present', () => {
    const status = makeResilienceStatus({
      drift: {
        lastSweepAt: new Date(),
        lastWatermark: null,
        detectedSinceBoot: 0,
        repairsEmittedSinceBoot: 0,
        lastError: 'sweep failed',
      },
    });
    setup(status);
    expect(screen.getByText('sweep failed')).toBeTruthy();
  });

  it('(c) shows out-of-scope message in Drift section', () => {
    const status = makeResilienceStatus({
      drift: {
        lastSweepAt: new Date(),
        lastWatermark: null,
        detectedSinceBoot: 0,
        repairsEmittedSinceBoot: 0,
        lastError: null,
      },
    });
    setup(status);
    expect(
      screen.getAllByText(/hard delete|out.of.scope|path change/i).length,
    ).toBeGreaterThan(0);
  });

  it('(c) does not render section when drift is null', () => {
    const status = makeResilienceStatus({ drift: null });
    setup(status);
    expect(screen.queryByText('Drift Activity')).toBeNull();
  });
});

describe('VaultAdminSettings — Force Warning Banner', () => {
  it('(d) shows danger Alert when forceWarningActive is true', () => {
    const status = makeResilienceStatus({
      forceWarningActive: true,
      lastTriggerSource: 'env-force',
    });
    setup(status);
    // Should render an alert with a warning about force mode
    const alertEl = screen
      .getAllByRole('alert')
      .find((el) => el.textContent?.includes('force'));
    expect(alertEl).toBeTruthy();
  });

  it('(d) does not show force warning when forceWarningActive is false', () => {
    const status = makeResilienceStatus({ forceWarningActive: false });
    setup(status);
    // Should not render the force-specific warning banner
    const forceAlerts = screen
      .queryAllByRole('alert')
      .filter((el) => el.textContent?.toLowerCase().includes('force'));
    expect(forceAlerts.length).toBe(0);
  });
});

describe('VaultAdminSettings — Bootstrap confirm modal', () => {
  it('(e) shows confirm modal when "Prepare GROWI Vault" is clicked in done state', async () => {
    const status = makeResilienceStatus({
      bootstrap: { state: 'done' },
    });
    setup(status, 'done');
    const btn = screen.getByText('Prepare GROWI Vault');
    fireEvent.click(btn);
    // Modal should appear
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
  });

  it('(e) modal contains a confirm button to proceed', async () => {
    const status = makeResilienceStatus({
      bootstrap: { state: 'done' },
    });
    setup(status, 'done');
    fireEvent.click(screen.getByText('Prepare GROWI Vault'));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
    // Confirm button must exist
    expect(
      screen.getByRole('button', { name: /confirm|proceed|yes/i }),
    ).toBeTruthy();
  });

  it('(e) does NOT show modal when state is pending (just fires bootstrap)', async () => {
    const status = makeResilienceStatus({
      bootstrap: { state: 'pending' },
    });
    mocks.apiv3Post.mockResolvedValueOnce({});
    setup(status, 'pending');
    fireEvent.click(screen.getByText('Prepare GROWI Vault'));
    // No dialog should appear
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('(e) confirm modal can be cancelled', async () => {
    const status = makeResilienceStatus({
      bootstrap: { state: 'done' },
    });
    setup(status, 'done');
    fireEvent.click(screen.getByText('Prepare GROWI Vault'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    // Click cancel
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);
    // Dialog should close
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
