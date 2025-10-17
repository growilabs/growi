import axios from 'axios';
import useSWRInfinite, { type SWRInfiniteResponse } from 'swr/infinite';

import type {
  LsxApiOptions,
  LsxApiParams,
  LsxApiResponseData,
} from '../../../interfaces/api';

import { type ParseNumOptionResult, parseNumOption } from './parse-num-option';

const LOADMORE_PAGES_NUM = 10;

export const useSWRxLsx = (
  pagePath: string,
  options?: Record<string, string | undefined>,
  isImmutable?: boolean,
): SWRInfiniteResponse<LsxApiResponseData, Error> => {
  return useSWRInfinite(
    // key generator
    (pageIndex, previousPageData) => {
      if (previousPageData != null && previousPageData.pages.length === 0)
        return null;

      // parse num option
      let initialOffsetAndLimit: ParseNumOptionResult | null = null;
      let parseError: Error | undefined;
      try {
        initialOffsetAndLimit =
          options?.num != null ? parseNumOption(options.num) : null;
      } catch (err) {
        parseError = err as Error;
      }

      // the first loading
      if (pageIndex === 0 || previousPageData == null) {
        return [
          '/_api/lsx',
          pagePath,
          options,
          initialOffsetAndLimit?.offset,
          initialOffsetAndLimit?.limit,
          parseError?.message,
          isImmutable,
        ];
      }

      // loading more
      return [
        '/_api/lsx',
        pagePath,
        options,
        previousPageData.cursor,
        LOADMORE_PAGES_NUM,
        parseError?.message,
        isImmutable,
      ];
    },

    // fetcher
    async ([endpoint, pagePath, options, offset, limit, parseErrorMessage]) => {
      if (parseErrorMessage != null) {
        throw new Error(parseErrorMessage);
      }

      const apiOptions = Object.assign({}, options, {
        num: undefined,
      }) as LsxApiOptions;
      const params: LsxApiParams = {
        pagePath,
        offset,
        limit,
        options: apiOptions,
      };
      try {
        const res = await axios.get<LsxApiResponseData>(endpoint, { params });
        return res.data;
      } catch (err) {
        if (axios.isAxiosError(err)) {
          throw new Error(err.response?.data);
        }
        throw new Error(err);
      }
    },

    // options
    {
      keepPreviousData: true,
      revalidateIfStale: !isImmutable,
      revalidateOnFocus: !isImmutable,
      revalidateOnReconnect: !isImmutable,
      revalidateFirstPage: false,
      revalidateAll: false,
    },
  );
};
