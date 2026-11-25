import type { BacklinksBackfillState } from '../../interfaces/page-link-backfill';

export type BackfillAdminViewKind =
  | 'notStarted'
  | 'running'
  | 'stopping'
  | 'failedRetryDue'
  | 'failed'
  | 'stopped'
  | 'partial'
  | 'all';

export interface BackfillControls {
  readonly stop: boolean;
  readonly resume: boolean;
  /** The scope picker and Start; `disabled` keeps them visible while a run is active. */
  readonly start: 'enabled' | 'disabled' | 'none';
}

export interface BackfillAdminView {
  readonly kind: BackfillAdminViewKind;
  readonly controls: BackfillControls;
}

// design.md, "Admin settings (what the admin sees)".
const CONTROLS: Readonly<Record<BackfillAdminViewKind, BackfillControls>> = {
  notStarted: { stop: false, resume: false, start: 'enabled' },
  running: { stop: true, resume: false, start: 'disabled' },
  stopping: { stop: false, resume: false, start: 'none' },
  failedRetryDue: { stop: true, resume: true, start: 'disabled' },
  failed: { stop: false, resume: true, start: 'enabled' },
  stopped: { stop: false, resume: true, start: 'enabled' },
  partial: { stop: false, resume: false, start: 'enabled' },
  all: { stop: false, resume: false, start: 'none' },
};

const toKind = (state: BacklinksBackfillState): BackfillAdminViewKind => {
  switch (state.status) {
    case 'requested':
      return 'running';
    // Only a running run acts on the flag; a failed one keeps it without stopping anything.
    case 'running':
      return state.stopRequested ? 'stopping' : 'running';
    case 'failed':
      return state.retryAt != null ? 'failedRetryDue' : 'failed';
    case 'stopped':
      return 'stopped';
    case 'idle':
    case 'complete':
      switch (state.coverage) {
        case 'all':
          return 'all';
        case 'partial':
          return 'partial';
        case 'none':
          return 'notStarted';
      }
  }
};

/** The one state the admin settings show for the job, with the controls it offers. */
export const toBackfillAdminView = (
  state: BacklinksBackfillState,
): BackfillAdminView => {
  const kind = toKind(state);
  return { kind, controls: CONTROLS[kind] };
};
