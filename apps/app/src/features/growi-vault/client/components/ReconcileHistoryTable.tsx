import type { JSX } from 'react';
import { Badge } from 'reactstrap';

import type { ReconcileLogEntry } from '~/features/growi-vault/server/services/reconcile/index.js';

// ============================================================================
// Types
// ============================================================================

type ReconcileHistoryTableProps = {
  entries: ReconcileLogEntry[];
  isLoading: boolean;
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Returns the reactstrap badge color for a given reconcile status.
 */
const statusBadgeColor = (status: ReconcileLogEntry['status']): string => {
  switch (status) {
    case 'completed':
      return 'success';
    case 'running':
      return 'primary';
    case 'failed':
      return 'danger';
    case 'rejected':
      return 'warning';
    case 'pending':
      return 'secondary';
    default:
      return 'secondary';
  }
};

/**
 * Format an ISO 8601 / Date value as a locale string.
 * Returns "—" when the value is null or undefined.
 */
const formatDate = (value: Date | string | null | undefined): string => {
  if (value == null) return '—';
  return new Date(value).toLocaleString();
};

// ============================================================================
// Component
// ============================================================================

/**
 * Displays a table of reconcile history entries.
 * Columns: triggeredAt / triggeredBy / target (type + path) / processedCount
 *          / status / completedAt / lastError
 */
export const ReconcileHistoryTable = (
  props: ReconcileHistoryTableProps,
): JSX.Element => {
  const { entries, isLoading } = props;

  if (isLoading) {
    return (
      <div
        className="d-flex justify-content-center py-4"
        data-testid="reconcile-history-loading"
      >
        <span
          className="spinner-border spinner-border-sm"
          role="status"
          aria-hidden="true"
        />
        <span className="ms-2">Loading…</span>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div
        className="text-muted py-4 text-center"
        data-testid="reconcile-history-empty"
      >
        No reconcile history.
      </div>
    );
  }

  return (
    <div className="table-responsive" data-testid="reconcile-history-table">
      <table className="table table-sm table-bordered table-hover">
        <thead className="table-light">
          <tr>
            <th>Triggered At</th>
            <th>Triggered By</th>
            <th>Target Type</th>
            <th>Target Path</th>
            <th>Processed</th>
            <th>Status</th>
            <th>Completed At</th>
            <th>Last Error</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.reconcileId}>
              <td className="text-nowrap">{formatDate(entry.triggeredAt)}</td>
              <td className="text-nowrap">
                {entry.triggeredBy.isAdmin ? (
                  <span>
                    {entry.triggeredBy.userId}{' '}
                    <span className="badge bg-secondary">admin</span>
                  </span>
                ) : (
                  entry.triggeredBy.userId
                )}
              </td>
              <td>{entry.targetType}</td>
              <td>
                <code>{entry.targetPath}</code>
              </td>
              <td>{entry.processedCount}</td>
              <td>
                <Badge color={statusBadgeColor(entry.status)}>
                  {entry.status}
                </Badge>
                {entry.rejectReason != null && (
                  <small className="ms-1 text-muted">
                    ({entry.rejectReason})
                  </small>
                )}
              </td>
              <td className="text-nowrap">{formatDate(entry.completedAt)}</td>
              <td>
                {entry.lastError != null ? (
                  <span className="text-danger">{entry.lastError}</span>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
