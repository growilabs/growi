import type { JSX } from 'react';
import { useCallback, useId, useState } from 'react';
import type { StorageStatsResponse } from '@growi/core/dist/interfaces/vault';
import {
  Alert,
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from 'reactstrap';
import useSWR from 'swr';

import { apiv3Get, apiv3Post, apiv3Put } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import type { ReconcileLogEntry } from '~/features/growi-vault/server/services/reconcile';

import { ReconcileHistoryTable } from '../components/ReconcileHistoryTable';
import { ReconcileTriggerModal } from '../components/ReconcileTriggerModal';

// ============================================================================
// Types
// ============================================================================

type BootstrapState =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'retrying'
  | 'escalated'
  | 'verifying';

type TriggerSource = 'env-true' | 'env-force' | 'admin-ui';

interface VaultStatusData {
  bootstrapState: BootstrapState;
  processed: number;
  totalEstimated: number | null;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  storageStats: StorageStatsResponse | null;
}

interface ResilienceBootstrapStatus {
  state: BootstrapState;
  cursor: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  totalEstimated: number | null;
  processed: number;
  lastError: string | null;
}

interface ResilienceRetryStatus {
  attemptNo: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  aborted: boolean;
}

interface ResilienceDriftStatus {
  lastSweepAt: Date | null;
  lastWatermark: Date | null;
  detectedSinceBoot: number;
  repairsEmittedSinceBoot: number;
  lastError: string | null;
}

interface ResilienceStatusData {
  bootstrap: ResilienceBootstrapStatus;
  retry: ResilienceRetryStatus | null;
  drift: ResilienceDriftStatus | null;
  lastTriggerSource: TriggerSource | null;
  forceWarningActive: boolean;
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

/** Completion Reliability section: last completeness check time, result, counts, trigger source. */
const CompletionReliabilitySection = ({
  resilienceData,
}: {
  resilienceData: ResilienceStatusData | undefined;
}): JSX.Element => {
  const bootstrap = resilienceData?.bootstrap;

  return (
    <div className="row mb-5">
      <div className="col-lg-12">
        <h2 className="admin-setting-header">Completion Reliability</h2>

        <table className="table table-sm table-bordered">
          <tbody>
            <tr>
              <th className="col-md-4">Check Result</th>
              <td>
                <span className="badge bg-secondary">
                  {bootstrap?.state ?? '—'}
                </span>
              </td>
            </tr>
            <tr>
              <th>Last Completed At</th>
              <td>
                {bootstrap?.completedAt != null
                  ? new Date(bootstrap.completedAt).toLocaleString()
                  : '—'}
              </td>
            </tr>
            <tr>
              <th>Processed / Estimated</th>
              <td>
                {bootstrap?.processed ?? 0} / {bootstrap?.totalEstimated ?? '—'}
              </td>
            </tr>
            <tr>
              <th>Trigger Source</th>
              <td>{resilienceData?.lastTriggerSource ?? '—'}</td>
            </tr>
            {bootstrap?.lastError != null && (
              <tr>
                <th>Last Error</th>
                <td className="text-danger">{bootstrap.lastError}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** Auto-Retry Status section: attempt info, abort button, escalation emphasis. */
const AutoRetryStatusSection = ({
  retryStatus,
  bootstrapState,
  onAbort,
}: {
  retryStatus: ResilienceRetryStatus;
  bootstrapState: BootstrapState | undefined;
  onAbort: () => Promise<void>;
}): JSX.Element => {
  const [isAborting, setIsAborting] = useState(false);
  const isEscalated = bootstrapState === 'escalated';

  const handleAbort = useCallback(async () => {
    setIsAborting(true);
    try {
      await onAbort();
    } finally {
      setIsAborting(false);
    }
  }, [onAbort]);

  return (
    <div className="row mb-5">
      <div className="col-lg-12">
        <h2 className="admin-setting-header">Auto-Retry Status</h2>

        {isEscalated && (
          <Alert color="danger" className="mb-3">
            <span className="material-symbols-outlined me-1 align-middle">
              error
            </span>
            Bootstrap has reached the <strong>escalated</strong> state.
            Auto-retry has been exhausted. Manual intervention is required.
          </Alert>
        )}

        <table className="table table-sm table-bordered">
          <tbody>
            <tr>
              <th className="col-md-4">Attempt No.</th>
              <td>{retryStatus.attemptNo}</td>
            </tr>
            <tr>
              <th>Next Attempt At</th>
              <td>
                {retryStatus.nextAttemptAt != null
                  ? new Date(retryStatus.nextAttemptAt).toLocaleString()
                  : '—'}
              </td>
            </tr>
            {retryStatus.lastError != null && (
              <tr>
                <th>Last Error</th>
                <td className="text-danger">{retryStatus.lastError}</td>
              </tr>
            )}
          </tbody>
        </table>

        <Button
          color="warning"
          disabled={retryStatus.aborted || isAborting}
          onClick={handleAbort}
        >
          {isAborting ? 'Aborting…' : 'Abort Auto-Retry'}
        </Button>
      </div>
    </div>
  );
};

/** Reconcile section: trigger manual reconcile + history table. */
const ReconcileSection = (): JSX.Element => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const {
    data: historyData,
    isLoading,
    mutate: mutateHistory,
  } = useSWR<{ entries: ReconcileLogEntry[]; total: number }>(
    '/vault/reconcile-history',
    (endpoint: string) =>
      apiv3Get<{ data: { entries: ReconcileLogEntry[]; total: number } }>(
        endpoint,
      ).then((res) => res.data.data),
    { refreshInterval: 5000 },
  );

  const handleAccepted = useCallback(() => {
    mutateHistory();
  }, [mutateHistory]);

  return (
    <div className="row mb-5">
      <div className="col-lg-12">
        <h2 className="admin-setting-header">Reconcile</h2>

        <div className="row mb-3">
          <div className="col-md-3"></div>
          <div className="col-md-9">
            <Button color="primary" onClick={() => setIsModalOpen(true)}>
              <span className="material-symbols-outlined me-1 align-middle">
                sync
              </span>
              Trigger Reconcile
            </Button>
            <p className="form-text text-muted mt-2">
              Manually repair drift between MongoDB pages and vault git trees
              without a full re-bootstrap.
            </p>
          </div>
        </div>

        <ReconcileHistoryTable
          entries={historyData?.entries ?? []}
          isLoading={isLoading}
        />

        <ReconcileTriggerModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          apiEndpoint="/vault/reconcile"
          onAccepted={handleAccepted}
        />
      </div>
    </div>
  );
};

/** Drift Activity section: sweep stats and out-of-scope notice. */
const DriftActivitySection = ({
  driftStatus,
}: {
  driftStatus: ResilienceDriftStatus;
}): JSX.Element => {
  return (
    <div className="row mb-5">
      <div className="col-lg-12">
        <h2 className="admin-setting-header">Drift Activity</h2>

        <table className="table table-sm table-bordered">
          <tbody>
            <tr>
              <th className="col-md-4">Last Sweep At</th>
              <td>
                {driftStatus.lastSweepAt != null
                  ? new Date(driftStatus.lastSweepAt).toLocaleString()
                  : '—'}
              </td>
            </tr>
            <tr>
              <th>Last Watermark</th>
              <td>
                {driftStatus.lastWatermark != null
                  ? new Date(driftStatus.lastWatermark).toLocaleString()
                  : '—'}
              </td>
            </tr>
            <tr>
              <th>Detected Since Boot</th>
              <td>{driftStatus.detectedSinceBoot}</td>
            </tr>
            <tr>
              <th>Repairs Emitted Since Boot</th>
              <td>{driftStatus.repairsEmittedSinceBoot}</td>
            </tr>
            {driftStatus.lastError != null && (
              <tr>
                <th>Last Error</th>
                <td className="text-danger">{driftStatus.lastError}</td>
              </tr>
            )}
          </tbody>
        </table>

        <p className="form-text text-muted mt-2">
          <strong>Note (out-of-scope):</strong> Path change drift (rename / hard
          delete) and grant drop drift are not detected in v1. These require
          future <code>growi-vault-ha</code> support.
        </p>
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
 *   2. Bootstrap       — trigger the initial data seeding (with confirm modal when state is 'done')
 *   3. Bootstrap status — progress and timestamps
 *   4. Completion Reliability — completeness check metrics from resilience layer
 *   5. Auto-Retry Status — retry attempt info (shown only when retry data exists)
 *   6. Drift Activity — drift detection sweep stats (shown only when drift data exists)
 *   7. Storage observability — repository stats from vault-manager
 *   8. Audit log filter link — quick link to vault-related audit log entries
 *
 * Data is polled every 5 s via SWR so operators can watch bootstrap progress
 * without manually refreshing the page.
 */
export const VaultAdminSettings = (): JSX.Element => {
  // ---- SWR polling: existing /vault/status (backward compat) ----
  const { data, mutate } = useSWR<VaultStatusData>(
    '/vault/status',
    (endpoint: string) =>
      apiv3Get<{ data: VaultStatusData }>(endpoint).then(
        (res) => res.data.data,
      ),
    { refreshInterval: 5000 },
  );

  // ---- SWR polling: new /vault/resilience-status ----
  const { data: resilienceData, mutate: mutateResilience } =
    useSWR<ResilienceStatusData>(
      '/vault/resilience-status',
      (endpoint: string) =>
        apiv3Get<{ data: ResilienceStatusData }>(endpoint).then(
          (res) => res.data.data,
        ),
      { refreshInterval: 5000 },
    );

  // ---- Derived state ----
  // vaultEnabled is not part of /status — we track it locally.
  const [vaultEnabled, setVaultEnabled] = useState<boolean>(false);

  // ---- Confirm modal state for "done-state" re-bootstrap ----
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
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

  const executeBootstrap = useCallback(async () => {
    try {
      await apiv3Post('/vault/bootstrap', {});
      toastSuccess(
        'Bootstrap started. Monitor progress in the Bootstrap Status section.',
      );
      await mutate();
      await mutateResilience();
    } catch (errs) {
      toastError(errs);
    }
  }, [mutate, mutateResilience]);

  const handleBootstrap = useCallback(async () => {
    // When bootstrap is already done, require explicit confirmation because
    // re-running involves a full wipe (requirement 1.10).
    if (data?.bootstrapState === 'done') {
      setIsConfirmModalOpen(true);
      return;
    }
    await executeBootstrap();
  }, [data?.bootstrapState, executeBootstrap]);

  const handleConfirmBootstrap = useCallback(async () => {
    setIsConfirmModalOpen(false);
    await executeBootstrap();
  }, [executeBootstrap]);

  const handleAbortRetry = useCallback(async () => {
    try {
      await apiv3Post('/vault/retry/abort', {});
      toastSuccess('Auto-retry aborted.');
      await mutateResilience();
    } catch (errs) {
      toastError(errs);
    }
  }, [mutateResilience]);

  return (
    <div data-testid="growi-vault-admin-settings">
      {/* Force Warning Banner — persistent danger alert when env-force is still active */}
      {resilienceData?.forceWarningActive === true && (
        <Alert color="danger" className="mb-4">
          <span className="material-symbols-outlined me-1 align-middle">
            warning
          </span>
          <strong>Warning:</strong> The last bootstrap was triggered by{' '}
          <code>VAULT_BOOTSTRAP_ON_START=force</code>. Restarting the server
          while this env var is still set to <code>force</code> will wipe all
          vault data again. Please change the env var to <code>true</code> or{' '}
          <code>false</code>.
        </Alert>
      )}

      <FeatureToggleSection
        vaultEnabled={vaultEnabled}
        bootstrapState={data?.bootstrapState}
        onToggle={handleToggle}
      />

      {/* Bootstrap operation with done-state confirm modal */}
      <div className="row mb-5">
        <div className="col-lg-12">
          <h2 className="admin-setting-header">Bootstrap Operation</h2>

          <div className="row">
            <div className="col-md-3"></div>
            <div className="col-md-9">
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  data?.bootstrapState === 'running' ||
                  data?.bootstrapState === 'verifying'
                }
                onClick={handleBootstrap}
              >
                {data?.bootstrapState === 'running' ||
                data?.bootstrapState === 'verifying' ? (
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
                Seeds all GROWI pages into the Vault git repository. Run this
                once before enabling the Vault feature for the first time.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Confirm modal: shown when bootstrap is already done (re-run = full wipe) */}
      <Modal
        isOpen={isConfirmModalOpen}
        toggle={() => setIsConfirmModalOpen(false)}
      >
        <ModalHeader toggle={() => setIsConfirmModalOpen(false)}>
          Confirm Re-Bootstrap
        </ModalHeader>
        <ModalBody>
          <p>
            Bootstrap has already completed. Running it again will perform a{' '}
            <strong>full wipe</strong> of all existing vault data before
            re-seeding from MongoDB.
          </p>
          <p>Are you sure you want to proceed?</p>
        </ModalBody>
        <ModalFooter>
          <Button color="danger" onClick={handleConfirmBootstrap}>
            Confirm
          </Button>
          <Button
            color="secondary"
            onClick={() => setIsConfirmModalOpen(false)}
          >
            Cancel
          </Button>
        </ModalFooter>
      </Modal>

      <BootstrapStatusSection data={data} />

      <CompletionReliabilitySection resilienceData={resilienceData} />

      {resilienceData?.retry != null && (
        <AutoRetryStatusSection
          retryStatus={resilienceData.retry}
          bootstrapState={resilienceData.bootstrap.state}
          onAbort={handleAbortRetry}
        />
      )}

      {resilienceData?.drift != null && (
        <DriftActivitySection driftStatus={resilienceData.drift} />
      )}

      <StorageObservabilitySection storageStats={data?.storageStats} />

      <AuditLogFilterSection />

      <ReconcileSection />
    </div>
  );
};
