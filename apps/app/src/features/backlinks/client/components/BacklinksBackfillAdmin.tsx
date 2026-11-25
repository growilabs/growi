import type { JSX } from 'react';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';

import { useBackfillActions } from '../hooks/use-backfill-actions';
import { useBackfillProgressSocket } from '../hooks/use-backfill-progress-socket';
import { useSWRxBacklinksBackfillState } from '../stores/backlinks-backfill';
import { toBackfillAdminView } from '../utils/backfill-admin-view';
import { BackfillProgress } from './BackfillProgress';
import { BackfillScopeForm } from './BackfillScopeForm';
import { BackfillStatusMessage } from './BackfillStatusMessage';

/** The admin settings section that starts, follows, stops and resumes the backlinks backfill. */
export const BacklinksBackfillAdmin = (): JSX.Element => {
  const { t } = useTranslation('admin');
  const { data: state, error, mutate } = useSWRxBacklinksBackfillState();
  useBackfillProgressSocket(mutate);
  const { start, stop, resume, isSubmitting } = useBackfillActions(mutate);

  if (error != null) {
    return (
      <p className="text-danger">
        {t('admin:backlinks_backfill.failed_to_fetch')}
      </p>
    );
  }
  if (state == null) {
    return <LoadingSpinner />;
  }

  const { kind, controls } = toBackfillAdminView(state);
  // A completed run keeps `status` and `runTotal` until the next Start, so its 100% bar stays
  // under the coverage line on every read until then.
  const showsProgress =
    state.runTotal != null &&
    (kind === 'running' || kind === 'stopping' || state.status === 'complete');

  return (
    <>
      <p className="card custom-card">
        {t('admin:backlinks_backfill.description')}
      </p>
      <BackfillStatusMessage kind={kind} state={state} />
      {showsProgress && <BackfillProgress state={state} />}
      {(controls.stop || controls.resume) && (
        <div className="d-flex gap-2 my-3">
          {controls.stop && (
            <button
              type="button"
              className="btn btn-outline-danger"
              disabled={isSubmitting}
              onClick={stop}
            >
              {t('admin:backlinks_backfill.stop')}
            </button>
          )}
          {controls.resume && (
            <button
              type="button"
              className="btn btn-outline-primary"
              disabled={isSubmitting}
              onClick={resume}
            >
              {t('admin:backlinks_backfill.resume')}
            </button>
          )}
        </div>
      )}
      {controls.start !== 'none' && (
        <BackfillScopeForm
          disabled={controls.start === 'disabled' || isSubmitting}
          onStart={start}
        />
      )}
    </>
  );
};
