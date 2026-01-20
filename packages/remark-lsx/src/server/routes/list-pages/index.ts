import type { IUser } from '@growi/core';
import { OptionParser } from '@growi/core/dist/remark-plugins';
import { pathUtils } from '@growi/core/dist/utils';
import escapeStringRegexp from 'escape-string-regexp';
import type { Request, Response } from 'express';
import createError, { isHttpError } from 'http-errors';

import type { LsxApiParams, LsxApiResponseData } from '../../../interfaces/api';
import { addDepthCondition } from './add-depth-condition';
import { addNumCondition } from './add-num-condition';
import { addSortCondition } from './add-sort-condition';
import { generateBaseQuery, type PageQuery } from './generate-base-query';
import { getToppageViewersCount } from './get-toppage-viewers-count';

const { addTrailingSlash, removeTrailingSlash } = pathUtils;

/**
 * add filter condition that filter fetched pages
 */
export function addFilterCondition(
  query,
  pagePath,
  optionsFilter,
  isExceptFilter = false,
): PageQuery {
  // when option strings is 'filter=', the option value is true
  if (optionsFilter == null || optionsFilter === true) {
    throw createError(
      400,
      'filter option require value in regular expression.',
    );
  }

  const pagePathForRegexp = escapeStringRegexp(addTrailingSlash(pagePath));

  let filterPath: RegExp;
  try {
    if (optionsFilter.charAt(0) === '^') {
      // move '^' to the first of path
      const escapedFilter = escapeStringRegexp(optionsFilter.slice(1));
      filterPath = new RegExp(`^${pagePathForRegexp}${escapedFilter}`);
    } else {
      const escapedFilter = escapeStringRegexp(optionsFilter);
      filterPath = new RegExp(`^${pagePathForRegexp}.*${escapedFilter}`);
    }
  } catch (err) {
    throw createError(400, err);
  }

  if (isExceptFilter) {
    return query.and({
      path: { $not: filterPath },
    });
  }
  return query.and({
    path: filterPath,
  });
}

function addExceptCondition(query, pagePath, optionsFilter): PageQuery {
  return addFilterCondition(query, pagePath, optionsFilter, true);
}

interface IListPagesRequest
  extends Request<undefined, undefined, undefined, LsxApiParams> {
  user: IUser;
}

export const listPages = ({
  getExcludedPaths,
}: {
  getExcludedPaths: () => string[];
}) => {
  return async (req: IListPagesRequest, res: Response): Promise<Response> => {
    const params: LsxApiParams = {
      pagePath: removeTrailingSlash(req.query.pagePath),
      offset: req.query?.offset,
      limit: req.query?.limit,
      options: req.query?.options ?? {},
    };

    const { pagePath, offset, limit, options } = params;

    // count viewers of `/`
    let toppageViewersCount: number;
    try {
      toppageViewersCount = await getToppageViewersCount();
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: Allow to use console.error here
      console.error('Error occurred in getToppageViewersCount:', error);
      return res.status(500).send('An internal server error occurred.');
    }

    try {
      const user = req.user;
      const builder = await generateBaseQuery(params.pagePath, user);
      let query = builder.query;

      const excludedPaths = getExcludedPaths();
      if (excludedPaths.length > 0) {
        const escapedPaths = excludedPaths.map((p) => {
          const cleanPath = p.startsWith('/') ? p.substring(1) : p;
          return escapeStringRegexp(cleanPath);
        });

        const regex = new RegExp(`^\\/(${escapedPaths.join('|')})(\\/|$)`);
        query = query.and([{ path: { $not: regex } }]);
      }

      // depth
      if (options?.depth != null) {
        query = addDepthCondition(
          query,
          params.pagePath,
          OptionParser.parseRange(options.depth),
        );
      }
      // filter
      if (options?.filter != null) {
        query = addFilterCondition(query, pagePath, options.filter);
      }
      if (options?.except != null) {
        query = addExceptCondition(query, pagePath, options.except);
      }

      // get total num before adding num/sort conditions
      const total = await query.clone().count();

      // num
      query = addNumCondition(query, offset, limit);
      // sort
      query = addSortCondition(query, options?.sort, options?.reverse);

      const pages = await query.exec();
      const cursor = (offset ?? 0) + pages.length;

      const responseData: LsxApiResponseData = {
        pages,
        cursor,
        total,
        toppageViewersCount,
      };
      return res.status(200).send(responseData);
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: Allow to use console.error here
      console.error(
        'Error occurred while processing listPages request:',
        error,
      );
      if (isHttpError(error)) {
        return res.status(error.status).send(error.message);
      }
      return res.status(500).send('An internal server error occurred.');
    }
  };
};
