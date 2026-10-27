import type { IPage, IUser } from '@growi/core/dist/interfaces';
import { SCOPE } from '@growi/core/dist/interfaces';
import type { AccessTokenParser } from '@growi/core/dist/interfaces/server';
import {
  serializeAttachmentSecurely,
  toLegacyAttachmentShape,
} from '@growi/core/dist/models/serializers';
import { OptionParser } from '@growi/core/dist/remark-plugins';
import { objectIdUtils } from '@growi/core/dist/utils';
import { loggerFactory } from '@growi/logger';
import type { Request } from 'express';
import { Router } from 'express';
import type { HydratedDocument, Model } from 'mongoose';
import mongoose from 'mongoose';
import { FilterXSS } from 'xss';

const logger = loggerFactory('growi:remark-attachment-refs:routes:refs');

function generateRegexp(expression: string): RegExp {
  // https://regex101.com/r/uOrwqt/2
  const matches = expression.match(/^\/(.+)\/(.*)?$/);

  return matches != null
    ? new RegExp(matches[1], matches[2])
    : new RegExp(expression);
}

// MongoDB rejects a JS-valid pattern that PCRE2 cannot parse (error code 51091);
// Prisma reports it as P2010 with the server message in meta.message.
function isInvalidRegexError(err: unknown): boolean {
  const { code, meta } = err as {
    code?: unknown;
    meta?: { message?: unknown };
  };
  return (
    code === 'P2010' &&
    typeof meta?.message === 'string' &&
    meta.message.includes('Error code 51091')
  );
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

export const routesFactory = (crowi): Router => {
  const loginRequired = crowi.loginRequiredFactory(
    crowi,
    true,
    loginRequiredFallback,
  );

  const accessTokenParser: AccessTokenParser = crowi.accessTokenParser;

  const prisma = crowi.prisma;

  const router = Router();

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
    // loginRequired,
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

      // biome-ignore lint/suspicious/noExplicitAny: ignore
      const orConditions: any[] = [{ originalName: fileNameOrId }];
      // Prisma throws on a non-24-hex ObjectId, and ObjectId.isValid accepts
      // any 12-character string such as `image001.png`
      if (objectIdUtils.isValidObjectId(fileNameOrId?.toString())) {
        orConditions.push({ id: fileNameOrId });
      }

      const attachment = await prisma.attachments.findFirst({
        where: {
          pageId: page._id.toString(),
          OR: orConditions,
        },
        include: { creator: true },
      });

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
        attachment.pageId,
        user,
      );
      if (!isAccessible) {
        logger.debug(
          `attachment '${attachment.id}' is forbidden for user '${user?.username}'`,
        );
        res.status(403).send(`page '${attachment.pageId}' is forbidden.`);
        return;
      }

      res.status(200).send({
        attachment: serializeAttachmentSecurely(
          toLegacyAttachmentShape(attachment),
        ),
      });
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
      const options: Record<string, string | undefined> =
        typeof req.query.options === 'string'
          ? JSON.parse(req.query.options)
          : (req.query.options ?? {});

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

      // Two queries on purpose:
      // 1. findRaw: Prisma's typed filters cannot express an arbitrary regex,
      //    so the filter is sent raw. This also keeps evaluation in MongoDB,
      //    whose PCRE match limit bounds catastrophic backtracking; filtering
      //    in-process with V8 has no such limit and would block the event loop.
      //    findRaw returns bare documents (no `include`, no computed fields),
      //    so only the matching ids are taken from it.
      // 2. findMany: re-fetch those ids through the extended client to get
      //    `creator` and the computed fields that serializeAttachmentSecurely needs.
      let matchedRows: { _id: { $oid: string } }[];
      try {
        matchedRows = (await prisma.attachments.findRaw({
          filter: {
            page: { $in: pageIds.map((id: string) => ({ $oid: id })) },
            ...(regex != null && {
              originalName: {
                $regex: regex.source,
                // MongoDB rejects JS flags it has no equivalent for (g, y, d, v)
                $options: regex.flags.replace(/[^imsu]/g, ''),
              },
            }),
          },
          options: { projection: { _id: 1 } },
        })) as unknown as { _id: { $oid: string } }[];
      } catch (err) {
        if (isInvalidRegexError(err)) {
          return res
            .status(400)
            .send("the 'regex' option is invalid as RegExp.");
        }
        logger.error('Failed to query attachments:', err);
        return res.status(500).send('Failed to retrieve attachments.');
      }

      const attachments = await prisma.attachments.findMany({
        where: { id: { in: matchedRows.map((row) => row._id.$oid) } },
        include: { creator: true },
      });

      res.status(200).send({
        attachments: attachments.map((attachment) =>
          serializeAttachmentSecurely(toLegacyAttachmentShape(attachment)),
        ),
      });
    },
  );

  return router;
};
