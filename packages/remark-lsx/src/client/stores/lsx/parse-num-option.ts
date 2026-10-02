import { OptionParser } from '@growi/core/dist/remark-plugins';

export type ParseNumOptionResult =
  | { offset: number; limit?: number }
  | { offset?: number; limit: number };

/**
 * add num condition that limit fetched pages
 */
export const parseNumOption = (
  optionsNum: string,
): ParseNumOptionResult | null => {
  if (Number.isInteger(Number(optionsNum))) {
    return { limit: Number(optionsNum) };
  }

  const range = OptionParser.parseRange(optionsNum);

  if (range == null) {
    return null;
  }

  const start = range.start;
  const end = range.end;

  // check start
  if (start < 1) {
    throw new Error(
      `The specified option 'num' is { start: ${start}, end: ${end} } : the start must be larger or equal than 1`,
    );
  }
  // check end
  if (start > end && end > 0) {
    throw new Error(
      `The specified option 'num' is { start: ${start}, end: ${end} } : the end must be larger or equal than the start`,
    );
  }

  const offset = start - 1;
  const limit = Math.max(-1, end - offset);

  return { offset, limit };
};
