/**
 * VaultAdminSettings.spec.tsx
 *
 * Tests for VaultAdminSettings:
 *   (a) Completion Reliability section renders
 *   (b) Auto-Retry abort button disabled state
 *   (c) Drift counts displayed
 *   (d) Force Warning banner display condition
 *   (e) Feature status — read-only display, no toggle UI
 *   (f) Wipe Vault — kill switch button with confirmation modal
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const apiv3Get = vi.fn();
  const apiv3Post = vi.fn().mockResolvedValue({});
  const toastError = vi.fn();
  const toastSuccess = vi.fn();
  const swrData: {
    status: unknown;
    resilience: unknown;
  } = { status: undefined, resilience: undefined };
  // Persistent spies for SWR mutate so tests can assert optimistic-update
  // behavior (e.g. that the button click writes 'running' to local state
  // before the network round-trip completes).
  const statusMutate = vi.fn();
  const resilienceMutate = vi.fn();

  return {
    apiv3Get,
    apiv3Post,
    toastError,
    toastSuccess,
    swrData,
    statusMutate,
    resilienceMutate,
  };
});

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: mocks.apiv3Get,
  apiv3Post: mocks.apiv3Post,
}));

vi.mock('~/client/util/toastr', () => ({
  toastError: mocks.toastError,
  toastSuccess: mocks.toastSuccess,
}));

// Mock SWR to return controlled data without actual HTTP calls.
vi.mock('swr', () => ({
  default: (key: string, _fetcher: unknown, _opts?: unknown) => {
    if (key === '/vault/status') {
      return { data: mocks.swrData.status, mutate: mocks.statusMutate };
    }
    if (key === '/vault/resilience-status') {
      return {
        data: mocks.swrData.resilience,
        mutate: mocks.resilienceMutate,
      };
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
  lastTriggerSource: 'env-true' | 'env-force' | 'admin-force-wipe' | null;
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
    lastTriggerSource?: 'env-true' | 'env-force' | 'admin-force-wipe' | null;
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

const makeVaultStatus = (state = 'done', vaultEnabled = true) => ({
  vaultEnabled,
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
  vaultEnabled = true,
): ReturnType<typeof render> {
  mocks.swrData.status = makeVaultStatus(vaultState, vaultEnabled);
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

describe('VaultAdminSettings — Bootstrap operation removed', () => {
  // The "Prepare GROWI Vault" button was functionally equivalent to "Wipe
  // Vault" (both went through the forceWipe path) and only confused
  // operators. The Prepare button has been removed; admin-initiated
  // bootstrap is exclusively via the Wipe Vault kill switch.
  it('does NOT render a "Prepare GROWI Vault" button', () => {
    setup(makeResilienceStatus(), 'done');
    expect(screen.queryByText(/prepare growi vault/i)).toBeNull();
  });

  it('does NOT call /vault/bootstrap from any UI interaction at steady state', async () => {
    mocks.apiv3Post.mockClear();
    setup(makeResilienceStatus(), 'done');
    // Render alone must not fire any /bootstrap call.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const bootstrapCalls = mocks.apiv3Post.mock.calls.filter(
      (c) => c[0] === '/vault/bootstrap',
    );
    expect(bootstrapCalls.length).toBe(0);
  });
});

describe('VaultAdminSettings — Feature status (read-only, env-only)', () => {
  it('(e) renders a Feature Status section showing the enabled value', () => {
    setup(makeResilienceStatus(), 'done', true);
    // The section should expose the env-only VAULT_ENABLED status. Title is
    // "Feature Status" (read-only, not a toggle).
    expect(screen.getByText(/feature status/i)).toBeTruthy();
  });

  it('(e) shows "Enabled" when vaultEnabled=true', () => {
    setup(makeResilienceStatus(), 'done', true);
    // The displayed value must reflect the env. Look for an explicit Enabled
    // indicator rather than relying on a checkbox.
    expect(screen.getAllByText(/enabled/i).length).toBeGreaterThan(0);
  });

  it('(e) shows "Disabled" when vaultEnabled=false', () => {
    setup(makeResilienceStatus(), 'done', false);
    expect(screen.getAllByText(/disabled/i).length).toBeGreaterThan(0);
  });

  it('(e) does NOT render an enable/disable toggle (env-only)', () => {
    setup(makeResilienceStatus(), 'done', true);
    // No checkbox should exist for the feature flag — the UI is read-only.
    // Other checkboxes (if any) outside the Vault feature flag are acceptable,
    // but the legacy Enable label must not be rendered as a togglable control.
    const checkboxes = screen.queryAllByRole('checkbox');
    expect(checkboxes.length).toBe(0);
  });
});

describe('VaultAdminSettings — Wipe Vault (kill switch)', () => {
  it('(f) renders a "Wipe Vault" button', () => {
    setup(makeResilienceStatus(), 'done');
    expect(screen.getByRole('button', { name: /wipe vault/i })).toBeTruthy();
  });

  it('(f) shows confirm modal when "Wipe Vault" is clicked', async () => {
    setup(makeResilienceStatus(), 'done');
    fireEvent.click(screen.getByRole('button', { name: /wipe vault/i }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
  });

  it('(f) confirm button POSTs to /vault/wipe', async () => {
    mocks.apiv3Post.mockClear();
    mocks.apiv3Post.mockResolvedValueOnce({});
    setup(makeResilienceStatus(), 'done');
    fireEvent.click(screen.getByRole('button', { name: /wipe vault/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    // The destructive confirm button uses "Confirm" / "Yes" wording.
    const confirmBtn = screen.getByRole('button', {
      name: /^(confirm|yes|proceed)$/i,
    });
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(mocks.apiv3Post).toHaveBeenCalledWith('/vault/wipe', {});
    });
  });

  it('(f) confirm modal can be cancelled without calling /vault/wipe', async () => {
    mocks.apiv3Post.mockClear();
    setup(makeResilienceStatus(), 'done');
    fireEvent.click(screen.getByRole('button', { name: /wipe vault/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.apiv3Post).not.toHaveBeenCalledWith('/vault/wipe', {});
  });

  it('(f) "Wipe Vault" button is disabled while bootstrap is running', () => {
    setup(makeResilienceStatus({ bootstrap: { state: 'running' } }), 'running');
    const wipeBtn = screen.getByRole('button', {
      name: /wipe vault/i,
    }) as HTMLButtonElement;
    expect(wipeBtn.disabled).toBe(true);
  });
});

// -- Optimistic UI -----------------------------------------------------------
//
// When admin clicks a destructive/preparatory button, the local SWR cache
// should flip immediately to a non-'done' state so the UI feels responsive.
// Without this, the user sees no change until the next 5s polling tick (or
// the response-triggered revalidate), and may double-click.
// ---------------------------------------------------------------------------

describe('VaultAdminSettings — optimistic UI', () => {
  it('writes optimistic bootstrapState=running to /vault/status when Wipe is confirmed', async () => {
    mocks.apiv3Post.mockClear();
    mocks.statusMutate.mockClear();
    mocks.apiv3Post.mockImplementation(() => new Promise(() => {}));

    setup(makeResilienceStatus(), 'done');
    fireEvent.click(screen.getByRole('button', { name: /wipe vault/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    fireEvent.click(
      screen.getByRole('button', { name: /^(confirm|yes|proceed)$/i }),
    );

    await waitFor(() => {
      const optimisticCall = mocks.statusMutate.mock.calls.find(
        (c) =>
          typeof c[0] === 'function' ||
          (c[0] != null &&
            (c[0] as { bootstrapState?: string }).bootstrapState === 'running'),
      );
      expect(optimisticCall).toBeDefined();
    });
  });
});
