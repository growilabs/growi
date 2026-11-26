import type {
  BacklinksBackfillJobStatus,
  BacklinksBackfillState,
} from '../../interfaces/page-link-backfill';

export type BackfillProgressInput = Pick<
  BacklinksBackfillState,
  'processed' | 'runTotal' | 'skippedPages'
> & { readonly status: BacklinksBackfillJobStatus };

export interface BackfillProgressDisplay {
  /** `processed`, capped at `runTotal`. */
  readonly processed: number;
  readonly runTotal: number;
  readonly percent: number;
  readonly skippedPages: number;
}

/** The run's progress as the admin sees it (design.md, "Counts shown to the admin"). */
export const toBackfillProgressDisplay = ({
  status,
  processed,
  runTotal,
  skippedPages,
}: BackfillProgressInput): BackfillProgressDisplay => {
  const total = runTotal ?? 0;
  const percent =
    status === 'complete'
      ? 100
      : total === 0
        ? 0
        : Math.min(99, Math.floor((processed / total) * 100));
  return {
    processed: Math.min(processed, total),
    runTotal: total,
    percent,
    skippedPages,
  };
};
