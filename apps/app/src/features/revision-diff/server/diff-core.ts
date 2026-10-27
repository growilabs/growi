import { createPatch } from 'diff';

export const buildUnifiedDiff = (
  pagePath: string,
  fromBody: string,
  toBody: string,
  contextLines: number,
): string => {
  return createPatch(pagePath, fromBody, toBody, '', '', {
    context: contextLines,
  });
};
