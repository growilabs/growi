import type { JSX } from 'react';
import { useCallback, useState } from 'react';
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

import { apiv3Get, apiv3Post } from '~/client/util/apiv3-client';
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

type TriggerSource = 'env-true' | 'env-force' | 'admin-ui' | 'admin-force-wipe';

interface VaultStatusData {
  /** Resolved from VAULT_ENABLED env var (read-only — fixed at deploy time). */
  vaultEnabled: boolean;
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

/**
 * Feature status (read-only).
 *
 * VAULT_ENABLED is an env-only flag fixed at deploy time — the admin UI never
 * mutates it. This section just surfaces the resolved value so operators can
 * confirm the deployed configuration.
 */
const FeatureStatusSection = ({
  vaultEnabled,
}: {
  vaultEnabled: boolean | undefined;
}): JSX.Element => {
  return (
    <div className="row mb-5">
      <div className="col-lg-12">
        <h2 className="admin-setting-header">GROWI Vault</h2>

        <div className="row form-group">
          <div className="col-md-3 text-md-end">
            <span className="col-form-label">Feature Status</span>
          </div>
          <div className="col-md-9">
            {vaultEnabled === true ? (
              <span className="badge bg-success">Enabled</span>
            ) : vaultEnabled === false ? (
              <span className="badge bg-secondary">Disabled</span>
            ) : (
              <span className="badge bg-light text-dark">—</span>
            )}
            <p className="form-text text-muted mt-2 mb-0">
              Controlled by the <code>VAULT_ENABLED</code> environment variable.
              To change this value, update the deployment env and restart
              apps/app. To stop serving clones at runtime without a restart, use
              the <strong>Wipe Vault</strong> kill switch below.
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
 *   1. Feature status   — read-only display of VAULT_ENABLED env var
 *   2. Bootstrap        — trigger the initial data seeding
 *   3. Kill switch      — Wipe Vault (destructive, with confirm modal)
 *   4. Bootstrap status — progress and timestamps
 *   5. Completion Reliability — completeness check metrics from resilience layer
 *   6. Auto-Retry Status — retry attempt info (shown only when retry data exists)
 *   7. Drift Activity   — drift detection sweep stats (shown only when drift data exists)
 *   8. Storage observability — repository stats from vault-manager
 *   9. Audit log filter link — quick link to vault-related audit log entries
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

  // ---- Confirm modal state for "Wipe Vault" kill switch ----
  const [isWipeModalOpen, setIsWipeModalOpen] = useState(false);

  // ---- Handlers ----

  // Optimistic local-state patch shown the instant the admin clicks a
  // destructive/preparatory button. Without this, the UI waits for the
  // server response (50–200ms) + the next SWR revalidate before reflecting
  // the new state, which feels unresponsive on a destructive action.
  const optimisticRunning = useCallback(
    (current: VaultStatusData | undefined): VaultStatusData => ({
      vaultEnabled: current?.vaultEnabled ?? false,
      bootstrapState: 'running',
      processed: 0,
      totalEstimated: current?.totalEstimated ?? null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      lastError: null,
      storageStats: current?.storageStats ?? null,
    }),
    [],
  );

  const handleBootstrap = useCallback(async () => {
    // Optimistic update first — `false` skips auto revalidate so we do not
    // race the server with a refetch.
    mutate(optimisticRunning, false);
    try {
      await apiv3Post('/vault/bootstrap', {});
      toastSuccess(
        'Bootstrap started. Monitor progress in the Bootstrap Status section.',
      );
      await mutate();
      await mutateResilience();
    } catch (errs) {
      toastError(errs);
      // Refetch authoritative state — rollback to whatever the server says.
      await mutate();
    }
  }, [mutate, mutateResilience, optimisticRunning]);

  const handleConfirmWipe = useCallback(async () => {
    setIsWipeModalOpen(false);
    mutate(optimisticRunning, false);
    try {
      await apiv3Post('/vault/wipe', {});
      toastSuccess(
        'Wipe started. The Vault is now serving 503 until re-bootstrap completes.',
      );
      await mutate();
      await mutateResilience();
    } catch (errs) {
      toastError(errs);
      await mutate();
    }
  }, [mutate, mutateResilience, optimisticRunning]);

  const handleAbortRetry = useCallback(async () => {
    try {
      await apiv3Post('/vault/retry/abort', {});
      toastSuccess('Auto-retry aborted.');
      await mutateResilience();
    } catch (errs) {
      toastError(errs);
    }
  }, [mutateResilience]);

  const isBootstrapRunning =
    data?.bootstrapState === 'running' || data?.bootstrapState === 'verifying';

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

      <FeatureStatusSection vaultEnabled={data?.vaultEnabled} />

      {/* Bootstrap operation */}
      <div className="row mb-5">
        <div className="col-lg-12">
          <h2 className="admin-setting-header">Bootstrap Operation</h2>

          <div className="row">
            <div className="col-md-3"></div>
            <div className="col-md-9">
              <button
                type="button"
                className="btn btn-primary"
                disabled={isBootstrapRunning}
                onClick={handleBootstrap}
              >
                {isBootstrapRunning ? (
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
                Seeds all GROWI pages into the Vault git repository. Safe to
                re-run; for a destructive wipe use the kill switch below.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Kill switch: Wipe Vault (destructive) */}
      <div className="row mb-5">
        <div className="col-lg-12">
          <h2 className="admin-setting-header">Kill Switch</h2>

          <div className="row">
            <div className="col-md-3"></div>
            <div className="col-md-9">
              <Button
                color="danger"
                disabled={isBootstrapRunning}
                onClick={() => setIsWipeModalOpen(true)}
              >
                <span className="material-symbols-outlined me-1 align-middle">
                  delete_forever
                </span>
                Wipe Vault
              </Button>
              <p className="form-text text-muted mt-2">
                Destroys all vault repositories and re-bootstraps from MongoDB.
                During the wipe, all <code>git clone</code> / <code>fetch</code>{' '}
                requests are rejected with 503. The action is recorded in the
                audit log as <code>vault.wipe</code>.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Confirm modal for Wipe Vault */}
      <Modal isOpen={isWipeModalOpen} toggle={() => setIsWipeModalOpen(false)}>
        <ModalHeader toggle={() => setIsWipeModalOpen(false)}>
          Confirm Wipe Vault
        </ModalHeader>
        <ModalBody>
          <p>
            This will <strong>destroy all vault repositories</strong> and
            re-seed from MongoDB. During the rebuild, git clients will receive{' '}
            <code>503 Service Unavailable</code>.
          </p>
          <p>Are you sure you want to proceed?</p>
        </ModalBody>
        <ModalFooter>
          <Button color="danger" onClick={handleConfirmWipe}>
            Confirm
          </Button>
          <Button color="secondary" onClick={() => setIsWipeModalOpen(false)}>
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
