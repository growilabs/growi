import type { RevisionMarkView } from '../../../interfaces';

export type RevisionMarksState = {
  readonly marks: ReadonlyMap<string, RevisionMarkView>;
  readonly isLoading: boolean;
};

export const useSWRxRevisionMarks = (
  _revisionIds: readonly string[] | null,
): RevisionMarksState => {
  throw new Error('Not implemented');
};

export const mutateAllRevisionMarks = (): Promise<void> => {
  throw new Error('Not implemented');
};
