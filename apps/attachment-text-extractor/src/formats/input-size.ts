import type { ConversionLimits } from '../contract';
import type { ResolvedFormat } from './format-table';

export interface InputSizeViolation {
  readonly failure: 'limit_exceeded';
  readonly detail: string;
}

export const checkInputSize = (
  _format: ResolvedFormat,
  _size: number,
  _limits: Pick<ConversionLimits, 'maxCsvBytes' | 'maxHtmlBytes'>,
): InputSizeViolation | null => {
  throw new Error('not implemented: formats/input-size.checkInputSize');
};
