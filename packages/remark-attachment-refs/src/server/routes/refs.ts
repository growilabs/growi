import type { IAttachment, IPage, IUser } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { serializeAttachmentSecurely } from '@growi/core/dist/models/serializers';
import { OptionParser } from '@growi/core/dist/remark-plugins';
import type { Request } from 'express';
import { Router } from 'express';
import type { HydratedDocument, Model } from 'mongoose';
import mongoose, { model, Types } from 'mongoose';
import { FilterXSS } from 'xss';

import loggerFactory from '../../utils/logger';

const logger = loggerFactory('growi:remark-attachment-refs:routes:refs');

function generateRegexp(expression: string): RegExp {
  // https://regex101.com/r/uOrwqt/2
  const matches = expression.match(/^\/(.+)\/(.*)?$/);

  return matches != null
    ? new RegExp(matches[1], matches[2])
    : new RegExp(expression);
}

/**
 * add depth condition that limit fetched pages
 *
 * @param {any} query
 * @param {any} pagePath
 * @param {any} optionsDepth
 * @returns query
 */
function addDepthCondition(query, pagePath, optionsDepth) {
  // when option strings is 'depth=', the option value is true
  if (optionsDepth == null || optionsDepth === true) {
    throw new Error('The value of depth option is invalid.');
  }

  const range = OptionParser.parseRange(optionsDepth);

  if (range == null) {
    return query;
  }

  const start = range.start;
  const end = range.end;

  if (start < 1 || end < 1) {
    throw new Error(
      `specified depth is [${start}:${end}] : start and end are must be larger than 1`,
    );
  }

  // count slash
  const slashNum = pagePath.split('/').length - 1;
  const depthStart = slashNum; // start is not affect to fetch page
  const depthEnd = slashNum + end - 1;

  return query.and({
    path: new RegExp(`^(\\/[^\\/]*){${depthStart},${depthEnd}}$`),
  });
}

type RequestWithUser = Request & { user: HydratedDocument<IUser> };

const loginRequiredFallback = (_req, res) => {
  return res.status(403).send('login required');
};

// biome-ignore lint/suspicious/noExplicitAny: ignore
export const routesFactory = (crowi): any => {
  const loginRequired = crowi.require('../middlewares/login-required')(
    crowi,
    true,
    loginRequiredFallback,
  );
  const accessTokenParser = crowi.accessTokenParser;

  const router = Router();

  const ObjectId = Types.ObjectId;

  // biome-ignore lint/suspicious/noExplicitAny: ignore
  const Page = mongoose.model<HydratedDocument<IPage>, Model<any> & any>(
    'Page',
  );

  // biome-ignore lint/suspicious/noExplicitAny: ignore
  const { PageQueryBuilder } = Page as any;

  /**
   * return an Attachment model
   */
  router.get(
    '/ref',
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    async (req: RequestWithUser, res) => {
      const user = req.user;
      const { pagePath, fileNameOrId } = req.query;
      const filterXSS = new FilterXSS();

      if (pagePath == null) {
        res.status(400).send("the param 'pagePath' must be set.");
        return;
      }

      const page = await Page.findByPathAndViewer(
        pagePath,
        user,
        undefined,
        true,
      );

      // not found
      if (page == null) {
        res
          .status(404)
          .send(
            filterXSS.process(
              `pagePath: '${pagePath}' is not found or forbidden.`,
            ),
          );
        return;
      }

      // convert ObjectId
      // biome-ignore lint/suspicious/noExplicitAny: ignore
      const orConditions: any[] = [{ originalName: fileNameOrId }];
      if (fileNameOrId != null && ObjectId.isValid(fileNameOrId.toString())) {
        orConditions.push({ _id: new ObjectId(fileNameOrId.toString()) });
      }

      const Attachment = model<IAttachment>('Attachment');
      const attachment = await Attachment.findOne({
        page: page._id,
        $or: orConditions,
      }).populate('creator');

      // not found
      if (attachment == null) {
        res
          .status(404)
          .send(
            filterXSS.process(`attachment '${fileNameOrId}' is not found.`),
          );
        return;
      }

      logger.debug(
        `attachment '${attachment.id}' is found from fileNameOrId '${fileNameOrId}'`,
      );

      // forbidden
      const isAccessible = await Page.isAccessiblePageByViewer(
        attachment.page,
        user,
      );
      if (!isAccessible) {
        logger.debug(
          `attachment '${attachment.id}' is forbidden for user '${user?.username}'`,
        );
        res.status(403).send(`page '${attachment.page}' is forbidden.`);
        return;
      }

      res
        .status(200)
        .send({ attachment: serializeAttachmentSecurely(attachment) });
    },
  );

  /**
   * return a list of Attachment
   */
  router.get(
    '/refs',
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    async (req: RequestWithUser, res) => {
      const user = req.user;
      const { prefix, pagePath } = req.query;
      const options: Record<string, string | undefined> = JSON.parse(
        req.query.options?.toString() ?? '',
      );

      // check either 'prefix' or 'pagePath ' is specified
      if (prefix == null && pagePath == null) {
        res
          .status(400)
          .send("either the param 'prefix' or 'pagePath' must be set.");
        return;
      }

      // check regex
      let regex: RegExp | null = null;
      const regexOptionValue = options.regexp ?? options.regex;
      if (regexOptionValue != null) {
        // check the length to avoid ReDoS
        if (regexOptionValue.length > 400) {
          res.status(400).send("the length of the 'regex' option is too long.");
          return;
        }

        try {
          regex = generateRegexp(regexOptionValue);
        } catch {
          res.status(400).send("the 'regex' option is invalid as RegExp.");
          return;
        }
      }

      // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
      let builder;

      // builder to retrieve descendance
      if (prefix != null) {
        builder = new PageQueryBuilder(Page.find())
          .addConditionToListWithDescendants(prefix)
          .addConditionToExcludeTrashed();
      }
      // builder to get single page
      else {
        builder = new PageQueryBuilder(Page.find({ path: { $eq: pagePath } }));
      }

      Page.addConditionToFilteringByViewerForList(builder, user, false);

      let pageQuery = builder.query;

      // depth
      try {
        if (prefix != null && options.depth != null) {
          pageQuery = addDepthCondition(pageQuery, prefix, options.depth);
        }
      } catch (err) {
        const filterXSS = new FilterXSS();
        return res.status(400).send(filterXSS.process(err.toString()));
      }

      const results = await pageQuery.select('id').exec();
      const pageIds = results.map((result) => result.id);

      logger.debug('retrieve attachments for pages:', pageIds);

      // create query to find
      const Attachment = model<IAttachment>('Attachment');
      let query = Attachment.find({
        page: { $in: pageIds },
      });
      // add regex condition
      if (regex != null) {
        query = query.and([{ originalName: { $regex: regex } }]);
      }

      const attachments = await query.populate('creator').exec();

      res.status(200).send({
        attachments: attachments.map((attachment) =>
          serializeAttachmentSecurely(attachment),
        ),
      });
    },
  );

  return router;
};
