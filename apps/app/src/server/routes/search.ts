import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import { SupportedAction } from '~/interfaces/activity';
import type {
  IFormattedSearchResult,
  ISearchResult,
} from '~/interfaces/search';
import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';
import UserGroupRelation from '../models/user-group-relation';
import { isSearchError } from '../models/vo/search-error';

const logger = loggerFactory('growi:routes:search');

/**
 * @swagger
 *
 *   components:
 *     schemas:
 *       ElasticsearchResultMeta:
 *         type: object
 *         properties:
 *           took:
 *             type: number
 *             description: Time Elasticsearch took to execute a search(milliseconds)
 *             example: 34
 *           total:
 *             type: number
 *             description: Number of documents matching search criteria
 *             example: 2
 *           results:
 *             type: number
 *             description: Actual array length of search results
 *             example: 2
 *
 *       ElasticsearchResult:
 *         description: Elasticsearch result v1
 *         type: object
 *         properties:
 *           meta:
 *             $ref: '#/components/schemas/ElasticsearchResultMeta'
 */
module.exports = (crowi: Crowi, app) => {
  const ApiResponse = require('../util/apiResponse');
  const ApiPaginate = require('../util/apiPaginate');

  const actions: any = {};
  const api: any = {};

  /**
   * @swagger
   *
   *   /search:
   *     get:
   *       tags: [Search]
   *       operationId: searchPages
   *       summary: /search
   *       description: Search pages
   *       parameters:
   *         - in: query
   *           name: q
   *           schema:
   *             type: string
   *             description: keyword
   *             example: daily report
   *           required: true
   *         - in: query
   *           name: path
   *           schema:
   *             $ref: '#/components/schemas/PagePath'
   *         - in: query
   *           name: offset
   *           schema:
   *             $ref: '#/components/schemas/Offset'
   *         - in: query
   *           name: limit
   *           schema:
   *             $ref: '#/components/schemas/Limit'
   *       responses:
   *         200:
   *           description: Succeeded to get list of pages.
   *           content:
   *             application/json:
   *               schema:
   *                 allOf:
   *                   - $ref: '#/components/schemas/ApiResponseSuccess'
   *                   - type: object
   *                     properties:
   *                       meta:
   *                         $ref: '#/components/schemas/ElasticsearchResultMeta'
   *                         description: Elasticsearch metadata
   *                       totalCount:
   *                         type: integer
   *                         description: total count of pages
   *                         example: 35
   *                       data:
   *                         type: array
   *                         items:
   *                           $ref: '#/components/schemas/Page'
   *                         description: page list
   *         403:
   *           $ref: '#/components/responses/Forbidden'
   *         500:
   *           $ref: '#/components/responses/InternalServerError'
   */
  /**
   * @api {get} /search search page
   * @apiName Search
   * @apiGroup Search
   *
   * @apiParam {String} q keyword
   * @apiParam {String} path
   * @apiParam {String} offset
   * @apiParam {String} limit
   */
  api.search = async (req, res) => {
    const user = req.user;
    const {
      q = null,
      nq = null,
      type = null,
      sort = null,
      order = null,
      vector = null,
    } = req.query;
    let paginateOpts: { limit: number; offset: number };

    try {
      paginateOpts = ApiPaginate.parseOptionsForElasticSearch(req.query);
    } catch (e) {
      return res.json(ApiResponse.error(e));
    }

    if (q === null || q === '') {
      return res.json(ApiResponse.error('The param "q" should not empty.'));
    }

    const { searchService } = crowi;
    if (!searchService.isReachable) {
      return res.json(ApiResponse.error('SearchService is not reachable.'));
    }

    const userGroups =
      user != null
        ? [
            ...(await UserGroupRelation.findAllUserGroupIdsRelatedToUser(user)),
            ...(await ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(
              user,
            )),
          ]
        : null;

    const searchOpts = {
      ...paginateOpts,
      type,
      sort,
      order,
      vector,
    };

    let searchResult: ISearchResult<unknown>;
    // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
    let delegatorName;
    try {
      const query = decodeURIComponent(q);
      const nqName = nq ?? decodeURIComponent(nq);
      [searchResult, delegatorName] = await searchService.searchKeyword(
        query,
        nqName,
        user,
        userGroups,
        searchOpts,
      );
    } catch (err) {
      logger.error('Failed to search', err);

      if (isSearchError(err)) {
        const { unavailableTermsKeys } = err;
        return res.json(ApiResponse.error(err, 400, { unavailableTermsKeys }));
      }

      return res.json(ApiResponse.error(err));
    }

    let result: IFormattedSearchResult;
    try {
      result = await searchService.formatSearchResult(
        searchResult,
        delegatorName,
        user,
        userGroups,
      );
    } catch (err) {
      logger.error(err);
      return res.json(ApiResponse.error(err));
    }

    const parameters = {
      ip: req.ip,
      endpoint: req.originalUrl,
      action: SupportedAction.ACTION_SEARCH_PAGE,
      user: req.user?._id,
      snapshot: {
        username: req.user?.username,
      },
    };
    await crowi.activityService.createActivity(parameters);

    return res.json(ApiResponse.success(result));
  };

  actions.api = api;
  return actions;
};
