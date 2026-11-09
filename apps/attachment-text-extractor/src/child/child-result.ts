import type { ConversionOutcome } from '../contract';

export const encodeChildResult = (
  _outcome: ConversionOutcome,
  _maxResultBytes: number,
): Buffer => {
  throw new Error('not implemented: child/child-result.encodeChildResult');
};
