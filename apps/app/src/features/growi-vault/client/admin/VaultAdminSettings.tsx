import type { JSX } from 'react';
import { useCallback, useId, useState } from 'react';
import type { StorageStatsResponse } from '@growi/core/dist/interfaces/vault';
import useSWR from 'swr';

import { apiv3Get, apiv3Post, apiv3Put } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';

// ============================================================================
// Types
// ============================================================================

type BootstrapState = 'pending' | 'running' | 'done' | 'failed';

interface VaultStatusData {
  bootstrapState: BootstrapState;
  processed: number;
  totalEstimated: number | null;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  storageStats: StorageStatsResponse | null;
}

// ============================================================================
// Helper utilities
// ============================================================================

/**
 * Format a byte count as a human-readable string (e.g. "1.23 MB").
 */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

/**
 * Format an ISO 8601 timestamp as a locale date/time string.
 * Returns "—" when the value is null or undefined.
 */
const formatDate = (iso: string | null | undefined): string => {
  if (iso == null) return '—';
  return new Date(iso).toLocaleString();
};

// ============================================================================
// Sub-sections
// ============================================================================

/** Feature toggle: enable / disable the Vault feature. */
const FeatureToggleSection = ({
  vaultEnabled,
  bootstrapState,
  onToggle,
}: {
  vaultEnabled: boolean;
  bootstrapState: BootstrapState | undefined;
  onToggle: (enabled: boolean) => Promise<void>;
}): JSX.Element => {
  const [isUpdating, setIsUpdating] = useState(false);
  const toggleId = useId();

  const handleChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.checked;
      setIsUpdating(true);
      try {
        await onToggle(next);
      } finally {
        setIsUpdating(false);
      }
    },
    [onToggle],
  );

  // Warn when the user tries to enable Vault before bootstrap is complete.
  const showBootstrapWarning = !vaultEnabled && bootstrapState !== 'done';

  return (
    <div className="row mb-5">
      <div className="col-lg-12">
        <h2 className="admin-setting-header">GROWI Vault</h2>

        <div className="row form-group">
          <div className="col-md-3 text-md-end">
            <label htmlFor="vaultEnabled" className="col-form-label">
              Enable GROWI Vault
            </label>
          </div>
          <div className="col-md-9">
            <div className="form-check form-switch">
              <input
                id={toggleId}
                type="checkbox"
                className="form-check-input"
                checked={vaultEnabled}
                disabled={isUpdating}
                onChange={handleChange}
              />
              <label className="form-check-label" htmlFor={toggleId}>
                {vaultEnabled ? 'Enabled' : 'Disabled'}
              </label>
            </div>

            {/* Warning: bootstrap must be done before enabling */}
            {showBootstrapWarning && (
              <div className="alert alert-warning mt-2">
                <span className="material-symbols-outlined me-1 align-middle">
                  warning
                </span>
                GROWI Vault cannot serve requests until bootstrap is complete
                (current state: <strong>{bootstrapState ?? '—'}</strong>).
                Enabling it now will cause git clients to receive 503 errors.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/** Bootstrap operation: trigger the initial bootstrap. */
const BootstrapOperationSection = ({
  bootstrapState,
  onBootstrap,
}: {
  bootstrapState: BootstrapState | undefined;
  onBootstrap: () => Promise<void>;
}): JSX.Element => {
  const [isStarting, setIsStarting] = useState(false);
  const isRunning = bootstrapState === 'running';

  const handleClick = useCallback(async () => {
    setIsStarting(true);
    try {
      await onBootstrap();
    } finally {
      setIsStarting(false);
    }
  }, [onBootstrap]);

  return (
    <div className="row mb-5">
      <div className="col-lg-12">
        <h2 className="admin-setting-header">Bootstrap Operation</h2>

        <div className="row">
          <div className="col-md-3"></div>
          <div className="col-md-9">
            <button
              type="button"
              className="btn btn-primary"
              disabled={isRunning || isStarting}
              onClick={handleClick}
            >
              {isRunning || isStarting ? (
                <>
                  <span
                    className="spinner-border spinner-border-sm me-2"
                    role="status"
                    aria-hidden="true"
                  />
                  Running...
                </>
              ) : (
                'Prepare GROWI Vault'
              )}
            </button>
            <p className="form-text text-muted mt-2">
              Seeds all GROWI pages into the Vault git repository. Run this once
              before enabling the Vault feature for the first time.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Bootstrap status: progress bar and timestamps. */
const BootstrapStatusSection = ({
  data,
}: {
  data: VaultStatusData | undefined;
}): JSX.Element => {
  const isRunning = data?.bootstrapState === 'running';
  const processed = data?.processed ?? 0;
  const totalEstimated = data?.totalEstimated ?? 0;

  // Progress as a percentage, capped at 100.
  const progressPct =
    isRunning && totalEstimated > 0
      ? Math.min(100, Math.round((processed / totalEstimated) * 100))
      : 0;

  return (
    <div className="row mb-5">
      <div className="col-lg-12">
        <h2 className="admin-setting-header">Bootstrap Status</h2>

        <table className="table table-sm table-bordered">
          <tbody>
            <tr>
              <th className="col-md-3">State</th>
              <td>
                <span
                  className={`badge ${
                    data?.bootstrapState === 'done'
                      ? 'bg-success'
                      : data?.bootstrapState === 'running'
                        ? 'bg-primary'
                        : data?.bootstrapState === 'failed'
                          ? 'bg-danger'
                          : 'bg-secondary'
                  }`}
                >
                  {data?.bootstrapState ?? '—'}
                </span>
              </td>
            </tr>
            <tr>
              <th>Processed / Total Estimated</th>
              <td>
                {processed} / {totalEstimated ?? '—'}
              </td>
            </tr>
            <tr>
              <th>Started At</th>
              <td>{formatDate(data?.startedAt)}</td>
            </tr>
            <tr>
              <th>Completed At</th>
              <td>{formatDate(data?.completedAt)}</td>
            </tr>
            {data?.lastError != null && (
              <tr>
                <th>Last Error</th>
                <td className="text-danger">{data.lastError}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Progress bar visible while bootstrap is running */}
        {isRunning && (
          <div className="mt-2">
            <div className="d-flex justify-content-between mb-1">
              <small>
                {processed} of {totalEstimated ?? '?'} pages
              </small>
              <small>{progressPct}%</small>
            </div>
            <div className="progress">
              <div
                className="progress-bar progress-bar-striped progress-bar-animated"
                role="progressbar"
                style={{ width: `${progressPct}%` }}
                aria-valuenow={progressPct}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/** Storage observability: stats fetched via vault-manager. */
const StorageObservabilitySection = ({
  storageStats,
}: {
  storageStats: StorageStatsResponse | null | undefined;
}): JSX.Element => {
  return (
    <div className="row mb-5">
      <div className="col-lg-12">
        <h2 className="admin-setting-header">Storage Observability</h2>

        {storageStats == null ? (
          <div className="alert alert-warning">
            <span className="material-symbols-outlined me-1 align-middle">
              error
            </span>
            Failed to retrieve storage statistics. vault-manager may be
            unreachable.
          </div>
        ) : (
          <table className="table table-sm table-bordered">
            <tbody>
              <tr>
                <th className="col-md-4">Namespace Count</th>
                <td>{storageStats.namespaceCount}</td>
              </tr>
              <tr>
                <th>Total Commit Count</th>
                <td>{storageStats.totalCommitCount.toLocaleString()}</td>
              </tr>
              <tr>
                <th>Loose Object Count</th>
                <td>{storageStats.looseObjectCount.toLocaleString()}</td>
              </tr>
              <tr>
                <th>Repository Size</th>
                <td>{formatBytes(storageStats.repoSizeBytes)}</td>
              </tr>
              <tr>
                <th>Last Squash</th>
                <td>{formatDate(storageStats.lastSquashAt)}</td>
              </tr>
              <tr>
                <th>Last GC</th>
                <td>{formatDate(storageStats.lastGcAt)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

/** Audit log filter link: deep link to audit log filtered by VAULT_* actions. */
const AuditLogFilterSection = (): JSX.Element => {
  return (
    <div className="row mb-5">
      <div className="col-lg-12">
        <h2 className="admin-setting-header">Audit Log</h2>

        <div className="row">
          <div className="col-md-3"></div>
          <div className="col-md-9">
            <a
              href="/admin/audit-log?action=VAULT_"
              className="btn btn-outline-secondary"
            >
              <span className="material-symbols-outlined me-1 align-middle">
                manage_search
              </span>
              View VAULT_* Audit Log Entries
            </a>
            <p className="form-text text-muted mt-2">
              Opens the admin audit log filtered to Vault-related actions
              (VAULT_*).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Main component
// ============================================================================

/**
 * Admin settings panel for GROWI Vault.
 *
 * Sections:
 *   1. Feature toggle  — enable / disable the Vault feature
 *   2. Bootstrap       — trigger the initial data seeding
 *   3. Bootstrap status — progress and timestamps
 *   4. Storage observability — repository stats from vault-manager
 *   5. Audit log filter link — quick link to vault-related audit log entries
 *
 * Data is polled every 5 s via SWR so operators can watch bootstrap progress
 * without manually refreshing the page.
 */
export const VaultAdminSettings = (): JSX.Element => {
  // ---- SWR polling ----
  const { data, mutate } = useSWR<VaultStatusData>(
    '/vault/status',
    (endpoint: string) =>
      apiv3Get<{ data: VaultStatusData }>(endpoint).then(
        (res) => res.data.data,
      ),
    { refreshInterval: 5000 },
  );

  // ---- Derived state ----
  // vaultEnabled is not part of /status — we track it locally.
  // The API response does not expose the config flag directly; the
  // feature-gate check is the canonical source of truth (bootstrapState
  // being 'done' implies the operator enabled it at some point), but we
  // maintain a local toggle state and keep it in sync via optimistic updates.
  const [vaultEnabled, setVaultEnabled] = useState<boolean>(false);

  // ---- Handlers ----

  const handleToggle = useCallback(async (enabled: boolean) => {
    try {
      await apiv3Put('/vault/enabled', { enabled });
      setVaultEnabled(enabled);
      toastSuccess(
        `GROWI Vault ${enabled ? 'enabled' : 'disabled'} successfully.`,
      );
    } catch (errs) {
      toastError(errs);
    }
  }, []);

  const handleBootstrap = useCallback(async () => {
    try {
      await apiv3Post('/vault/bootstrap', {});
      toastSuccess(
        'Bootstrap started. Monitor progress in the Bootstrap Status section.',
      );
      // Immediately refresh status so the running state appears without waiting
      // for the next polling tick.
      await mutate();
    } catch (errs) {
      toastError(errs);
    }
  }, [mutate]);

  return (
    <div data-testid="growi-vault-admin-settings">
      <FeatureToggleSection
        vaultEnabled={vaultEnabled}
        bootstrapState={data?.bootstrapState}
        onToggle={handleToggle}
      />

      <BootstrapOperationSection
        bootstrapState={data?.bootstrapState}
        onBootstrap={handleBootstrap}
      />

      <BootstrapStatusSection data={data} />

      <StorageObservabilitySection storageStats={data?.storageStats} />

      <AuditLogFilterSection />
    </div>
  );
};
