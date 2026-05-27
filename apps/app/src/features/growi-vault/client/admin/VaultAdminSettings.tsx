import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StorageStatsResponse } from '@growi/core/dist/interfaces/vault';
import { useTranslation } from 'next-i18next';
import {
  Alert,
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Tooltip,
} from 'reactstrap';
import useSWR from 'swr';

import { apiv3Get, apiv3Post } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import type { ReconcileLogEntry } from '~/features/growi-vault/server/services/reconcile';
import { useSiteUrl } from '~/states/global';

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

type TriggerSource = 'env-true' | 'env-force' | 'admin-force-wipe';

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
 *
 * Also displays the `git clone <siteUrl>/vault.git` command (clipboard-copyable)
 * directly under the feature status row so admins can quickly share the URL.
 */
const FeatureStatusSection = ({
  vaultEnabled,
  storageStats,
}: {
  vaultEnabled: boolean | undefined;
  storageStats: StorageStatsResponse | null | undefined;
}): JSX.Element => {
  const { t } = useTranslation('admin');
  const siteUrl = useSiteUrl();

  // Strip a trailing slash so we never produce `https://host//vault.git`.
  const cloneCommand = useMemo(() => {
    if (siteUrl == null || siteUrl === '') return null;
    return `git clone ${siteUrl.replace(/\/$/, '')}/vault.git`;
  }, [siteUrl]);

  // Reactstrap Tooltip needs a stable target. A ref bypasses
  // querySelectorAll (see apps/app/.claude/rules/ui-pitfalls.md — useId() output
  // is not a valid CSS selector).
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const [isCopiedTooltipOpen, setIsCopiedTooltipOpen] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending dismiss timer on unmount to avoid a setState on an
  // unmounted component if the admin navigates away mid-copy.
  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    if (cloneCommand == null) return;
    try {
      await navigator.clipboard.writeText(cloneCommand);
      setIsCopiedTooltipOpen(true);
      if (copiedTimerRef.current != null) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(
        () => setIsCopiedTooltipOpen(false),
        1500,
      );
    } catch (_err) {
      toastError(t('growi-vault.admin-settings.clone-url.copy-failed'));
    }
  }, [cloneCommand, t]);

  return (
    <div className="row mb-5">
      <div className="col-lg-12">
        <h2 className="admin-setting-header">
          {t('growi-vault.admin-settings.feature-status.heading')}
        </h2>

        <div className="row form-group mt-5">
          <div className="col-md-2"></div>
          <div className="col-md-8">
            {cloneCommand == null ? (
              <p
                className="form-text text-muted mb-0"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: i18n string contains controlled HTML markup
                dangerouslySetInnerHTML={{
                  __html: t(
                    'growi-vault.admin-settings.clone-url.no-site-url_html',
                  ),
                }}
              />
            ) : (
              <>
                <div className="input-group">
                  <input
                    type="text"
                    className="form-control font-monospace"
                    value={cloneCommand}
                    readOnly
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label={t('growi-vault.admin-settings.clone-url.label')}
                  />
                  <Button
                    innerRef={copyButtonRef}
                    color="secondary"
                    outline
                    onClick={handleCopy}
                    aria-label={t(
                      'growi-vault.admin-settings.clone-url.copy-button',
                    )}
                  >
                    <span className="material-symbols-outlined align-middle">
                      content_copy
                    </span>
                  </Button>
                  <Tooltip
                    isOpen={isCopiedTooltipOpen}
                    target={copyButtonRef}
                    placement="top"
                  >
                    {t('growi-vault.admin-settings.clone-url.copied-tooltip')}
                  </Tooltip>
                </div>
                <p className="form-text text-muted mt-2 mb-0">
                  {t('growi-vault.admin-settings.clone-url.description')}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="row form-group mt-5">
          <div className="col-md-3 text-md-end">
            <span className="col-form-label">
              {t('growi-vault.admin-settings.feature-status.label')}
            </span>
          </div>
          <div className="col-md-9">
            {vaultEnabled === true ? (
              <span className="badge bg-info">
                {t('growi-vault.admin-settings.feature-status.enabled')}
              </span>
            ) : vaultEnabled === false ? (
              <span className="badge bg-secondary">
                {t('growi-vault.admin-settings.feature-status.disabled')}
              </span>
            ) : (
              <span className="badge bg-light text-dark">—</span>
            )}
            <p
              className="form-text text-muted mt-2 mb-0"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: i18n string contains controlled HTML markup
              dangerouslySetInnerHTML={{
                __html: t(
                  'growi-vault.admin-settings.feature-status.description_html',
                ),
              }}
            />
          </div>
        </div>

        <div className="row mt-3">
          <div className="col-md-3"></div>
          <div className="col-md-9">
            {storageStats == null ? (
              <div className="alert alert-warning">
                <span className="material-symbols-outlined me-1 align-middle">
                  error
                </span>
                {t(
                  'growi-vault.admin-settings.storage-observability.fetch-failed',
                )}
              </div>
            ) : (
              <table className="table table-sm table-bordered">
                <tbody>
                  <tr>
                    <th className="col-md-4">
                      {t(
                        'growi-vault.admin-settings.storage-observability.namespace-count',
                      )}
                    </th>
                    <td>{storageStats.namespaceCount}</td>
                  </tr>
                  <tr>
                    <th>
                      {t(
                        'growi-vault.admin-settings.storage-observability.total-commit-count',
                      )}
                    </th>
                    <td>{storageStats.totalCommitCount.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <th>
                      {t(
                        'growi-vault.admin-settings.storage-observability.loose-object-count',
                      )}
                    </th>
                    <td>{storageStats.looseObjectCount.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <th>
                      {t(
                        'growi-vault.admin-settings.storage-observability.repo-size',
                      )}
                    </th>
                    <td>{formatBytes(storageStats.repoSizeBytes)}</td>
                  </tr>
                  <tr>
                    <th>
                      {t(
                        'growi-vault.admin-settings.storage-observability.last-squash',
                      )}
                    </th>
                    <td>{formatDate(storageStats.lastSquashAt)}</td>
                  </tr>
                  <tr>
                    <th>
                      {t(
                        'growi-vault.admin-settings.storage-observability.last-gc',
                      )}
                    </th>
                    <td>{formatDate(storageStats.lastGcAt)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/** Bootstrap status: progress bar, timestamps, and kill switch. */
const BootstrapStatusSection = ({
  data,
  onConfirmWipe,
}: {
  data: VaultStatusData | undefined;
  onConfirmWipe: () => Promise<void>;
}): JSX.Element => {
  const { t } = useTranslation('admin');
  const [isWipeModalOpen, setIsWipeModalOpen] = useState(false);

  const isRunning = data?.bootstrapState === 'running';
  const isBootstrapRunning =
    data?.bootstrapState === 'running' || data?.bootstrapState === 'verifying';
  const processed = data?.processed ?? 0;
  const totalEstimated = data?.totalEstimated ?? 0;

  // Progress as a percentage, capped at 100.
  const progressPct =
    isRunning && totalEstimated > 0
      ? Math.min(100, Math.round((processed / totalEstimated) * 100))
      : 0;

  return (
    <>
      {/* Kill switch: Wipe Vault (the only admin-triggered bootstrap path) */}
      <div className="row">
        <div className="col-lg-12">
          <h2 className="admin-setting-header">
            {t('growi-vault.admin-settings.kill-switch.heading')}
          </h2>

          <div className="row">
            <div className="col-md-3"></div>
            <div className="col-md-9">
              <Button
                color="danger"
                disabled={isBootstrapRunning}
                onClick={() => setIsWipeModalOpen(true)}
              >
                <span className="material-symbols-outlined me-1 align-middle">
                  cycle
                </span>
                {t('growi-vault.admin-settings.kill-switch.button')}
              </Button>
              <p
                className="form-text text-muted mt-2"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: i18n string contains controlled HTML markup
                dangerouslySetInnerHTML={{
                  __html: t(
                    'growi-vault.admin-settings.kill-switch.description_html',
                  ),
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="row mt-3">
        <div className="col-md-3"></div>
        <div className="col-md-9">
          <table className="table table-sm table-bordered">
            <tbody>
              <tr>
                <th className="col-md-3">
                  {t('growi-vault.admin-settings.bootstrap-status.state')}
                </th>
                <td>
                  <span
                    className={`badge ${
                      data?.bootstrapState === 'done'
                        ? 'bg-info'
                        : data?.bootstrapState === 'running'
                          ? 'bg-success'
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
                <th>
                  {t(
                    'growi-vault.admin-settings.bootstrap-status.processed-total',
                  )}
                </th>
                <td>
                  {processed} / {totalEstimated ?? '—'}
                </td>
              </tr>
              <tr>
                <th>
                  {t('growi-vault.admin-settings.bootstrap-status.started-at')}
                </th>
                <td>{formatDate(data?.startedAt)}</td>
              </tr>
              <tr>
                <th>
                  {t(
                    'growi-vault.admin-settings.bootstrap-status.completed-at',
                  )}
                </th>
                <td>{formatDate(data?.completedAt)}</td>
              </tr>
              {data?.lastError != null && (
                <tr>
                  <th>
                    {t(
                      'growi-vault.admin-settings.bootstrap-status.last-error',
                    )}
                  </th>
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
                  {t(
                    'growi-vault.admin-settings.bootstrap-status.progress-label',
                    {
                      processed,
                      total: totalEstimated ?? '?',
                    },
                  )}
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

      {/* Confirm modal for Wipe Vault */}
      <Modal isOpen={isWipeModalOpen} toggle={() => setIsWipeModalOpen(false)}>
        <ModalHeader toggle={() => setIsWipeModalOpen(false)}>
          {t('growi-vault.admin-settings.kill-switch.confirm-title')}
        </ModalHeader>
        <ModalBody>
          <p
            // biome-ignore lint/security/noDangerouslySetInnerHtml: i18n string contains controlled HTML markup
            dangerouslySetInnerHTML={{
              __html: t(
                'growi-vault.admin-settings.kill-switch.confirm-message_html',
              ),
            }}
          />
          <p>{t('growi-vault.admin-settings.kill-switch.confirm-question')}</p>
        </ModalBody>
        <ModalFooter>
          <Button
            color="danger"
            onClick={async () => {
              setIsWipeModalOpen(false);
              await onConfirmWipe();
            }}
          >
            {t('growi-vault.admin-settings.kill-switch.confirm-button')}
          </Button>
          <Button color="secondary" onClick={() => setIsWipeModalOpen(false)}>
            {t('growi-vault.admin-settings.kill-switch.cancel-button')}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
};

/** Audit log filter link: deep link to audit log filtered by VAULT_* actions. */
const AuditLogFilterSection = (): JSX.Element => {
  const { t } = useTranslation('admin');

  return (
    <div className="row mb-5">
      <div className="col-lg-12">
        <h2 className="admin-setting-header">
          {t('growi-vault.admin-settings.audit-log.heading')}
        </h2>

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
              {t('growi-vault.admin-settings.audit-log.button')}
            </a>
            <p className="form-text text-muted mt-2">
              {t('growi-vault.admin-settings.audit-log.description')}
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
  const { t } = useTranslation('admin');
  const bootstrap = resilienceData?.bootstrap;

  return (
    <div className="row mb-5">
      <div className="col-lg-12">
        <h2 className="admin-setting-header">
          {t('growi-vault.admin-settings.completion-reliability.heading')}
        </h2>

        <table className="table table-sm table-bordered">
          <tbody>
            <tr>
              <th className="col-md-4">
                {t(
                  'growi-vault.admin-settings.completion-reliability.check-result',
                )}
              </th>
              <td>
                <span
                  className={`badge ${
                    bootstrap?.state === 'done'
                      ? 'bg-info'
                      : bootstrap?.state === 'running'
                        ? 'bg-success'
                        : bootstrap?.state === 'failed'
                          ? 'bg-danger'
                          : 'bg-secondary'
                  }`}
                >
                  {bootstrap?.state ?? '—'}
                </span>
              </td>
            </tr>
            <tr>
              <th>
                {t(
                  'growi-vault.admin-settings.completion-reliability.last-completed-at',
                )}
              </th>
              <td>
                {bootstrap?.completedAt != null
                  ? new Date(bootstrap.completedAt).toLocaleString()
                  : '—'}
              </td>
            </tr>
            <tr>
              <th>
                {t(
                  'growi-vault.admin-settings.completion-reliability.processed-estimated',
                )}
              </th>
              <td>
                {bootstrap?.processed ?? 0} / {bootstrap?.totalEstimated ?? '—'}
              </td>
            </tr>
            <tr>
              <th>
                {t(
                  'growi-vault.admin-settings.completion-reliability.trigger-source',
                )}
              </th>
              <td>{resilienceData?.lastTriggerSource ?? '—'}</td>
            </tr>
            {bootstrap?.lastError != null && (
              <tr>
                <th>
                  {t(
                    'growi-vault.admin-settings.completion-reliability.last-error',
                  )}
                </th>
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
  const { t } = useTranslation('admin');
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
        <h2 className="admin-setting-header">
          {t('growi-vault.admin-settings.auto-retry-status.heading')}
        </h2>

        {isEscalated && (
          <Alert color="danger" className="mb-3">
            <span className="material-symbols-outlined me-1 align-middle">
              error
            </span>
            <span
              // biome-ignore lint/security/noDangerouslySetInnerHtml: i18n string contains controlled HTML markup
              dangerouslySetInnerHTML={{
                __html: t(
                  'growi-vault.admin-settings.auto-retry-status.escalated-warning_html',
                ),
              }}
            />
          </Alert>
        )}

        <table className="table table-sm table-bordered">
          <tbody>
            <tr>
              <th className="col-md-4">
                {t('growi-vault.admin-settings.auto-retry-status.attempt-no')}
              </th>
              <td>{retryStatus.attemptNo}</td>
            </tr>
            <tr>
              <th>
                {t(
                  'growi-vault.admin-settings.auto-retry-status.next-attempt-at',
                )}
              </th>
              <td>
                {retryStatus.nextAttemptAt != null
                  ? new Date(retryStatus.nextAttemptAt).toLocaleString()
                  : '—'}
              </td>
            </tr>
            {retryStatus.lastError != null && (
              <tr>
                <th>
                  {t('growi-vault.admin-settings.auto-retry-status.last-error')}
                </th>
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
          {isAborting
            ? t('growi-vault.admin-settings.auto-retry-status.aborting')
            : t('growi-vault.admin-settings.auto-retry-status.abort-button')}
        </Button>
      </div>
    </div>
  );
};

/** Reconcile section: trigger manual reconcile + history table. */
const ReconcileSection = (): JSX.Element => {
  const { t } = useTranslation('admin');
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
        <h2 className="admin-setting-header">
          {t('growi-vault.admin-settings.reconcile-admin.heading')}
        </h2>

        <div className="row mb-3">
          <div className="col-md-3"></div>
          <div className="col-md-9">
            <Button color="primary" onClick={() => setIsModalOpen(true)}>
              <span className="material-symbols-outlined me-1 align-middle">
                construction
              </span>
              {t('growi-vault.admin-settings.reconcile-admin.trigger-button')}
            </Button>
            <p className="form-text text-muted mt-2">
              {t('growi-vault.admin-settings.reconcile-admin.description')}
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
  const { t } = useTranslation('admin');

  return (
    <div className="row mb-5">
      <div className="col-lg-12">
        <h2 className="admin-setting-header">
          {t('growi-vault.admin-settings.drift-activity.heading')}
        </h2>

        <table className="table table-sm table-bordered">
          <tbody>
            <tr>
              <th className="col-md-4">
                {t('growi-vault.admin-settings.drift-activity.last-sweep-at')}
              </th>
              <td>
                {driftStatus.lastSweepAt != null
                  ? new Date(driftStatus.lastSweepAt).toLocaleString()
                  : '—'}
              </td>
            </tr>
            <tr>
              <th>
                {t('growi-vault.admin-settings.drift-activity.last-watermark')}
              </th>
              <td>
                {driftStatus.lastWatermark != null
                  ? new Date(driftStatus.lastWatermark).toLocaleString()
                  : '—'}
              </td>
            </tr>
            <tr>
              <th>
                {t(
                  'growi-vault.admin-settings.drift-activity.detected-since-boot',
                )}
              </th>
              <td>{driftStatus.detectedSinceBoot}</td>
            </tr>
            <tr>
              <th>
                {t(
                  'growi-vault.admin-settings.drift-activity.repairs-emitted-since-boot',
                )}
              </th>
              <td>{driftStatus.repairsEmittedSinceBoot}</td>
            </tr>
            {driftStatus.lastError != null && (
              <tr>
                <th>
                  {t('growi-vault.admin-settings.drift-activity.last-error')}
                </th>
                <td className="text-danger">{driftStatus.lastError}</td>
              </tr>
            )}
          </tbody>
        </table>

        <p
          className="form-text text-muted mt-2"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: i18n string contains controlled HTML markup
          dangerouslySetInnerHTML={{
            __html: t(
              'growi-vault.admin-settings.drift-activity.out-of-scope_html',
            ),
          }}
        />
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
 *   2. Kill switch      — Wipe Vault (destructive, with confirm modal).
 *                         The ONLY admin-triggered bootstrap entry point — a
 *                         separate "Prepare" button was removed because it was
 *                         internally equivalent to Wipe (same forceWipe path)
 *                         and misled admins about destructiveness.
 *   3. Bootstrap status — progress and timestamps
 *   4. Completion Reliability — completeness check metrics from resilience layer
 *   5. Auto-Retry Status — retry attempt info (shown only when retry data exists)
 *   6. Drift Activity   — drift detection sweep stats (shown only when drift data exists)
 *   7. Storage observability — repository stats from vault-manager
 *   8. Audit log filter link — quick link to vault-related audit log entries
 *
 * Data is polled every 5 s via SWR so operators can watch bootstrap progress
 * without manually refreshing the page.
 */
export const VaultAdminSettings = (): JSX.Element => {
  const { t } = useTranslation('admin');

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

  const handleConfirmWipe = useCallback(async () => {
    mutate(optimisticRunning, false);
    try {
      await apiv3Post('/vault/wipe', {});
      toastSuccess(t('growi-vault.admin-settings.kill-switch.started-toast'));
      await mutate();
      await mutateResilience();
    } catch (errs) {
      toastError(errs);
      await mutate();
    }
  }, [mutate, mutateResilience, optimisticRunning, t]);

  const handleAbortRetry = useCallback(async () => {
    try {
      await apiv3Post('/vault/retry/abort', {});
      toastSuccess(
        t('growi-vault.admin-settings.auto-retry-status.aborted-toast'),
      );
      await mutateResilience();
    } catch (errs) {
      toastError(errs);
    }
  }, [mutateResilience, t]);

  return (
    <div data-testid="growi-vault-admin-settings">
      {/* Force Warning Banner — persistent danger alert when env-force is still active */}
      {resilienceData?.forceWarningActive === true && (
        <Alert color="danger" className="mb-4">
          <span className="material-symbols-outlined me-1 align-middle">
            warning
          </span>
          <strong>{t('growi-vault.admin-settings.force-warning.label')}</strong>{' '}
          <span
            // biome-ignore lint/security/noDangerouslySetInnerHtml: i18n string contains controlled HTML markup
            dangerouslySetInnerHTML={{
              __html: t(
                'growi-vault.admin-settings.force-warning.message_html',
              ),
            }}
          />
        </Alert>
      )}

      <FeatureStatusSection
        vaultEnabled={data?.vaultEnabled}
        storageStats={data?.storageStats}
      />

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

      <AuditLogFilterSection />

      <ReconcileSection />

      <BootstrapStatusSection data={data} onConfirmWipe={handleConfirmWipe} />
    </div>
  );
};
