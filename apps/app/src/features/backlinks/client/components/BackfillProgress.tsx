import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';
import { Progress } from 'reactstrap';

import type { BacklinksBackfillState } from '../../interfaces/page-link-backfill';
import { toBackfillProgressDisplay } from '../utils/backfill-progress';

type Props = {
  readonly state: BacklinksBackfillState;
};

export const BackfillProgress = ({ state }: Props): JSX.Element => {
  const { t } = useTranslation('admin');
  const { processed, runTotal, percent, skippedPages } =
    toBackfillProgressDisplay(state);
  const isComplete = state.status === 'complete';

  return (
    <div className="my-3">
      <div data-testid="backfill-progress">
        <h6 className="my-1">
          {t('admin:backlinks_backfill.progress', {
            processed,
            total: runTotal,
            percent,
          })}
        </h6>
        {/* The bar takes the capped percent, not processed/runTotal, so it never fills early. */}
        <Progress
          value={percent}
          max={100}
          color={isComplete ? 'success' : 'info'}
          striped={!isComplete}
          animated={!isComplete}
        />
      </div>
      {skippedPages > 0 && (
        <p className="text-muted small mt-1" data-testid="backfill-skipped">
          {t('admin:backlinks_backfill.skipped', { skipped: skippedPages })}
        </p>
      )}
    </div>
  );
};
