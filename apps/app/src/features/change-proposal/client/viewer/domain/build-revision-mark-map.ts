import type { RevisionMarkView } from '../../../interfaces';

export const buildRevisionMarkMap = (
  marks: readonly RevisionMarkView[],
): ReadonlyMap<string, RevisionMarkView> =>
  new Map(marks.map((mark) => [mark.revisionId, mark]));
