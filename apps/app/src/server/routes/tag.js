import { SupportedAction } from '~/interfaces/activity';
import Tag from '~/server/models/tag';

import PageTagRelation from '../models/page-tag-relation';
import { Revision } from '../models/revision';
import ApiResponse from '../util/apiResponse';

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi, app) => {
  const activityEvent = crowi.event('activity');
  const actions = {};
  const api = {};

  actions.api = api;

  /**
   * @swagger
   *
   *    /tags.search:
   *      get:
   *        tags: [Tags]
   *        operationId: searchTags
   *        summary: /tags.search
   *        description: Search tags
   *        parameters:
   *          - in: query
   *            name: q
   *            schema:
   *              type: string
   *              description: keyword
   *              example: daily
   *            description: keyword to search
   *        responses:
   *          200:
   *            description: Succeeded to tag list.
   *            content:
   *              application/json:
   *                schema:
   *                  allOf:
   *                    - $ref: '#/components/schemas/ApiResponseSuccess'
   *                    - type: object
   *                      properties:
   *                        tags:
   *                          $ref: '#/components/schemas/Tags'
   *                          description: List of matching tags
   *          403:
   *            $ref: '#/components/responses/Forbidden'
   *          500:
   *            $ref: '#/components/responses/InternalServerError'
   */
  /**
   * @api {get} /tags.search search tags
   * @apiName SearchTag
   * @apiGroup Tag
   *
   * @apiParam {String} q keyword
   */
  api.search = async (req, res) => {
    // https://regex101.com/r/J1cN6O/1
    // prevent from unexpecting attack doing regular expression on tag search (DoS attack)
    // Search for regular expressions as normal characters
    // e.g. user*$ -> user\*\$ (escape a regular expression)
    const escapeRegExp = req.query.q.replace(/[\\^$/.*+?()[\]{}|]/g, '\\$&');
    let tags = await Tag.find({ name: new RegExp(`^${escapeRegExp}`) }).select(
      '_id name',
    );
    tags = tags.map((tag) => {
      return tag.name;
    });
    return res.json(ApiResponse.success({ tags }));
  };

  /**
   * @swagger
   *
   *    /tags.update:
   *      post:
   *        tags: [Tags]
   *        operationId: updateTag
   *        summary: /tags.update
   *        description: Update tag
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  pageId:
   *                    $ref: '#/components/schemas/ObjectId'
   *                  revisionId:
   *                    $ref: '#/components/schemas/ObjectId'
   *                  tags:
   *                    $ref: '#/components/schemas/Tags'
   *        responses:
   *          200:
   *            description: Succeeded to update tag.
   *            content:
   *              application/json:
   *                schema:
   *                  allOf:
   *                    - $ref: '#/components/schemas/ApiResponseSuccess'
   *                    - type: object
   *                      properties:
   *                        tags:
   *                          $ref: '#/components/schemas/Tags'
   *                          description: Updated tags for the page
   *          403:
   *            $ref: '#/components/responses/Forbidden'
   *          500:
   *            $ref: '#/components/responses/InternalServerError'
   */
  /**
   * @api {post} /tags.update update tags on view-mode (not edit-mode)
   * @apiName UpdateTag
   * @apiGroup Tag
   *
   * @apiParam {String} PageId
   * @apiParam {array} tags
   */
  api.update = async (req, res) => {
    const Page = crowi.model('Page');
    const User = crowi.model('User');
    const tagEvent = crowi.event('tag');
    const pageId = req.body.pageId;
    const tags = req.body.tags;
    const userId = req.user._id;
    const revisionId = req.body.revisionId;

    const result = {};
    try {
      // TODO GC-1921 consider permission
      const page = await Page.findById(pageId);
      const user = await User.findById(userId);

      if (!(await Page.isAccessiblePageByViewer(page._id, user))) {
        return res.json(
          ApiResponse.error("You don't have permission to update this page."),
        );
      }

      const previousRevision = await Revision.findById(revisionId);
      result.savedPage = await crowi.pageService.updatePage(
        page,
        previousRevision.body,
        previousRevision.body,
        req.user,
      );
      await PageTagRelation.updatePageTags(pageId, tags);
      result.tags = await PageTagRelation.listTagNamesByPage(pageId);

      tagEvent.emit('update', page, tags);
    } catch (err) {
      return res.json(ApiResponse.error(err));
    }

    activityEvent.emit('update', res.locals.activity._id, {
      action: SupportedAction.ACTION_TAG_UPDATE,
    });

    return res.json(ApiResponse.success(result));
  };

  /**
   * @swagger
   *
   *    /tags.list:
   *      get:
   *        tags: [Tags]
   *        operationId: listTags
   *        summary: /tags.list
   *        description: Get tags
   *        parameters:
   *          - in: query
   *            name: limit
   *            schema:
   *              $ref: '#/components/schemas/Limit'
   *          - in: query
   *            name: offset
   *            schema:
   *              $ref: '#/components/schemas/Offset'
   *        responses:
   *          200:
   *            description: Succeeded to tag list.
   *            content:
   *              application/json:
   *                schema:
   *                  allOf:
   *                    - $ref: '#/components/schemas/ApiResponseSuccess'
   *                    - type: object
   *                      properties:
   *                        data:
   *                          type: array
   *                          items:
   *                            $ref: '#/components/schemas/Tag'
   *                          description: List of tags with count information
   *          403:
   *            $ref: '#/components/responses/Forbidden'
   *          500:
   *            $ref: '#/components/responses/InternalServerError'
   */
  /**
   * @api {get} /tags.list get tagnames and count pages relate each tag
   * @apiName tagList
   * @apiGroup Tag
   *
   * @apiParam {Number} limit
   * @apiParam {Number} offset
   */
  api.list = async (req, res) => {
    const limit = +req.query.limit || 50;
    const offset = +req.query.offset || 0;
    const sortOpt = { count: -1, _id: -1 };
    const queryOptions = { offset, limit, sortOpt };

    try {
      // get tag list contains id name and count properties
      const tagsWithCount =
        await PageTagRelation.createTagListWithCount(queryOptions);

      return res.json(ApiResponse.success(tagsWithCount));
    } catch (err) {
      return res.json(ApiResponse.error(err));
    }
  };

  return actions;
};
