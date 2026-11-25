import type { BacklinksBackfillState } from '../../interfaces/page-link-backfill';
import {
  type BackfillAdminView,
  type BackfillControls,
  toBackfillAdminView,
} from './backfill-admin-view';

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
  totalPageCount: 0,
  ...overrides,
});

const PARTIAL = {
  coverage: 'partial',
  coveredSince: '2026-03-01T12:00:00.000Z',
} as const;
const RETRY_AT = '2026-03-02T12:00:00.000Z';

const START_ONLY: BackfillControls = {
  stop: false,
  resume: false,
  start: 'enabled',
};
const NONE: BackfillControls = { stop: false, resume: false, start: 'none' };

// design.md, "Admin settings (what the admin sees)": one state at a time, read from the job
// document, each with its own controls.
describe('toBackfillAdminView', () => {
  it.each<
    [
      string,
      BacklinksBackfillState,
      BackfillAdminView['kind'],
      BackfillControls,
    ]
  >([
    ['coverage none, idle', stateOf(), 'notStarted', START_ONLY],
    [
      'requested',
      stateOf({ status: 'requested' }),
      'running',
      { stop: true, resume: false, start: 'disabled' },
    ],
    [
      'running',
      stateOf({ status: 'running', runTotal: 100, processed: 10 }),
      'running',
      { stop: true, resume: false, start: 'disabled' },
    ],
    [
      'running with a stop requested',
      stateOf({ status: 'running', stopRequested: true }),
      'stopping',
      NONE,
    ],
    [
      'failed with a retry due',
      stateOf({ status: 'failed', retryAt: RETRY_AT, failedAttempts: 1 }),
      'failedRetryDue',
      { stop: true, resume: true, start: 'disabled' },
    ],
    [
      'failed with no retry due',
      stateOf({ status: 'failed', failedAttempts: 4 }),
      'failed',
      { stop: false, resume: true, start: 'enabled' },
    ],
    // A run that fails while a Stop is pending keeps the flag; it is not "stopping".
    [
      'failed while a stop was pending',
      stateOf({ status: 'failed', stopRequested: true }),
      'failed',
      { stop: false, resume: true, start: 'enabled' },
    ],
    [
      'stopped',
      stateOf({ status: 'stopped', runTotal: 100, processed: 40 }),
      'stopped',
      { stop: false, resume: true, start: 'enabled' },
    ],
    ['coverage partial, idle', stateOf({ ...PARTIAL }), 'partial', START_ONLY],
    [
      'coverage partial after a complete run',
      stateOf({ ...PARTIAL, status: 'complete' }),
      'partial',
      START_ONLY,
    ],
    [
      'coverage all',
      stateOf({ status: 'complete', coverage: 'all' }),
      'all',
      NONE,
    ],
    [
      'coverage none after a run that covered nothing new',
      stateOf({ status: 'complete' }),
      'notStarted',
      START_ONLY,
    ],
  ])('shows %s', (_label, state, kind, controls) => {
    const view = toBackfillAdminView(state);

    expect(view.kind).toBe(kind);
    expect(view.controls).toEqual(controls);
  });
});
