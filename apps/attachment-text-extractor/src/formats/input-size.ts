import type { ConversionLimits } from '../contract';
import type { ResolvedFormat, TextKind } from './format-table';

export interface InputSizeViolation {
  readonly failure: 'limit_exceeded';
  readonly detail: string;
}

type InputSizeLimits = Pick<ConversionLimits, 'maxCsvBytes' | 'maxHtmlBytes'>;

// CSV and TSV share the text kind "csv"; formats absent here have no cap.
const CAP_KEY_BY_TEXT_KIND: Partial<
  Readonly<Record<TextKind, keyof InputSizeLimits>>
> = {
  csv: 'maxCsvBytes',
  html: 'maxHtmlBytes',
};

export const checkInputSize = (
  format: ResolvedFormat,
  size: number,
  limits: InputSizeLimits,
): InputSizeViolation | null => {
  const capKey =
    format.textKind == null ? undefined : CAP_KEY_BY_TEXT_KIND[format.textKind];
  if (capKey == null || size <= limits[capKey]) {
    return null;
  }
  return {
    failure: 'limit_exceeded',
    detail: 'input exceeds the size limit for its format',
  };
};
