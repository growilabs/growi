/**
 * POST /_api/v3/inline-comments — origin (anchored) inline comment creation,
 * from an anchor or from a part of the page markdown (requirement 26).
 *
 * `certifySharedPage` is intentionally NOT applied — this route must be
 * unreachable from a share-link context. `addActivity` is also intentionally
 * NOT applied: `InlineCommentService.create()` self-mints its own Activity id
 * via `prisma.activities.createByParameters` (see
 * `.claude/rules/activity-recording.md`); applying `addActivity` here would
 * register a failsafe finalizer that writes a spurious `ACTION_UNSETTLED` row
 * alongside the real one the service already wrote.
 *
 * `excludeReadOnlyUserIfCommentNotAllowed` is the same middleware normal
 * comments use for `/comments.add`, and that `update.ts` already applies to
 * inline comment edits, placed right after `loginRequired` — this makes the
 * read-only-user restriction a server-side guarantee for creation too, not
 * only a client-side affordance a direct API call could bypass.
 */

import assert from 'node:assert';
import type { IUser } from '@growi/core';
import { getIdStringForRef, isIPageNotFoundInfo, SCOPE } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { body } from 'express-validator';
import type { HydratedDocument } from 'mongoose';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import { excludeReadOnlyUserIfCommentNotAllowed } from '~/server/middlewares/exclude-read-only-user';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { findPageAndMetaDataByViewer } from '~/server/service/page/find-page-and-meta-data-by-viewer';
import { isRevisionOfPage } from '~/server/util/is-revision-of-page';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type {
  CreateInlineCommentByAnchorRequestBody,
  CreateInlineCommentByMarkdownQuoteRequestBody,
  CreateInlineCommentRequestBody,
} from '../../interfaces/dto/create-inline-comment';
import {
  type CreateInlineCommentInput,
  InlineCommentService,
} from '../service/inline-comment-service';
import {
  type MarkdownQuoteAnchorResolution,
  resolveMarkdownQuoteAnchor,
} from '../service/markdown-quote-anchor';
import { updatePageCommentCount } from '../update-page-comment-count';

const logger = loggerFactory('growi:routes:apiv3:inline-comments:create');

type Req = Request<
  Record<string, never>,
  ApiV3Response,
  CreateInlineCommentRequestBody
> & {
  user?: HydratedDocument<IUser>;
};

const MAX_MARKDOWN_QUOTE_LENGTH = 2000;

// The two input modes are told apart by the presence of `markdownQuote`.
const isAnchorMode = () => body('markdownQuote').not().exists();
const isMarkdownQuoteMode = () => body('markdownQuote').exists();

const validator = [
  body('pageId').isMongoId().withMessage('pageId must be a valid MongoId'),
  body('comment').isString().withMessage('comment must be a string'),
  body('anchorOriginRevisionId')
    .if(isAnchorMode())
    .isMongoId()
    .withMessage('anchorOriginRevisionId must be a valid MongoId'),
  body('anchor')
    .if(isAnchorMode())
    .isObject()
    .withMessage('anchor must be an object'),
  body('anchor.quote')
    .if(isAnchorMode())
    .isString()
    .withMessage('anchor.quote must be a string'),
  body('anchor.prefix')
    .if(isAnchorMode())
    .isString()
    .withMessage('anchor.prefix must be a string'),
  body('anchor.suffix')
    .if(isAnchorMode())
    .isString()
    .withMessage('anchor.suffix must be a string'),
  body('anchor.approxOffset')
    .if(isAnchorMode())
    .isInt({ min: 0 })
    .withMessage('anchor.approxOffset must be a non-negative integer'),
  body('markdownQuote')
    .if(isMarkdownQuoteMode())
    .isString()
    .withMessage('markdownQuote must be a string')
    .bail()
    .isLength({ min: 1, max: MAX_MARKDOWN_QUOTE_LENGTH })
    .withMessage(
      `markdownQuote must be 1 to ${MAX_MARKDOWN_QUOTE_LENGTH} characters long`,
    ),
  body('markdownOffset')
    .if(isMarkdownQuoteMode())
    .optional()
    .isInt({ min: 0 })
    .withMessage('markdownOffset must be a non-negative integer')
    .toInt(),
  body('revisionId')
    .if(isMarkdownQuoteMode())
    .optional()
    .isMongoId()
    .withMessage('revisionId must be a valid MongoId'),
  body(['markdownOffset', 'revisionId'])
    .if(isAnchorMode())
    .not()
    .exists()
    .withMessage(
      'markdownOffset and revisionId can be sent only with markdownQuote',
    ),
  body(['anchor', 'anchorOriginRevisionId'])
    .if(isMarkdownQuoteMode())
    .not()
    .exists()
    .withMessage(
      'anchor and anchorOriginRevisionId cannot be sent together with markdownQuote',
    ),
];

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      InlineCommentAnchor:
 *        description: >
 *          Where an inline comment points in the page body. Every value is measured
 *          against the page body as rendered in the browser, as plain text (the text
 *          a reader sees and selects, without markdown syntax), not against the
 *          markdown source. When the page is displayed, the passage is searched for
 *          again with `quote` and `approxOffset`: an exact match first, then the
 *          closest approximate match; if neither is found the comment is still shown,
 *          only without a highlight.
 *        type: object
 *        required:
 *          - quote
 *          - prefix
 *          - suffix
 *          - approxOffset
 *        properties:
 *          quote:
 *            type: string
 *            description: >
 *              The commented passage, exactly as it appears in the rendered text. Must
 *              not be empty. The server does not check that it occurs in the page.
 *          prefix:
 *            type: string
 *            description: >
 *              Text right before the passage. Stored, but not used to find the passage
 *              again. May be empty.
 *          suffix:
 *            type: string
 *            description: >
 *              Text right after the passage. Stored, but not used to find the passage
 *              again. May be empty.
 *          approxOffset:
 *            type: integer
 *            minimum: 0
 *            description: >
 *              Rough position of the start of the passage in the rendered text, in
 *              UTF-16 code units. Used only to choose among several occurrences of
 *              the same `quote`.
 *      InlineComment:
 *        description: >
 *          An origin inline comment: a comment anchored to a passage of the page body.
 *          Only origin comments carry an anchor and a resolved state; replies are
 *          `InlineCommentReply`.
 *        type: object
 *        required:
 *          - id
 *          - pageId
 *          - creatorId
 *          - creator
 *          - comment
 *          - anchorOriginRevisionId
 *          - anchor
 *          - resolvedById
 *          - resolvedAt
 *          - createdAt
 *          - updatedAt
 *        properties:
 *          id:
 *            type: string
 *          pageId:
 *            type: string
 *          creatorId:
 *            type: string
 *          creator:
 *            type: object
 *            nullable: true
 *            description: Always null in the responses of the write operations. GET /comments returns the creator.
 *          comment:
 *            type: string
 *            description: Comment body (markdown).
 *          anchorOriginRevisionId:
 *            type: string
 *            description: The revision of the page the anchor was taken from. Never changes after creation.
 *          anchor:
 *            $ref: '#/components/schemas/InlineCommentAnchor'
 *          resolvedById:
 *            type: string
 *            nullable: true
 *            description: The user who resolved the thread. Null while unresolved.
 *          resolvedAt:
 *            type: string
 *            format: date-time
 *            nullable: true
 *            description: When the thread was resolved. Null while unresolved.
 *          createdAt:
 *            type: string
 *            format: date-time
 *          updatedAt:
 *            type: string
 *            format: date-time
 *      InlineCommentReply:
 *        description: A reply to an origin inline comment. Has no anchor and no resolved state.
 *        type: object
 *        required:
 *          - id
 *          - pageId
 *          - creatorId
 *          - creator
 *          - comment
 *          - replyToId
 *          - createdAt
 *          - updatedAt
 *        properties:
 *          id:
 *            type: string
 *          pageId:
 *            type: string
 *          creatorId:
 *            type: string
 *          creator:
 *            type: object
 *            nullable: true
 *            description: Always null in the responses of the write operations. GET /comments returns the creator.
 *          comment:
 *            type: string
 *            description: Comment body (markdown).
 *          replyToId:
 *            type: string
 *            description: The origin inline comment this reply belongs to.
 *          createdAt:
 *            type: string
 *            format: date-time
 *          updatedAt:
 *            type: string
 *            format: date-time
 *      CreateInlineCommentByAnchorRequest:
 *        description: >
 *          Creation with an anchor measured against the rendered page text, the way
 *          the browser creates an inline comment from a text selection.
 *        type: object
 *        required:
 *          - pageId
 *          - anchorOriginRevisionId
 *          - comment
 *          - anchor
 *        properties:
 *          pageId:
 *            type: string
 *            description: ID of the page.
 *          anchorOriginRevisionId:
 *            type: string
 *            description: >
 *              ID of the page revision the anchor was taken from: the latest
 *              revision when the passage was chosen.
 *          comment:
 *            type: string
 *            description: Comment body (markdown).
 *          anchor:
 *            $ref: '#/components/schemas/InlineCommentAnchor'
 *      CreateInlineCommentByMarkdownQuoteRequest:
 *        description: >
 *          Creation with a part of the page body markdown, for callers that have the
 *          markdown but not the rendered text (for example an AI agent through the
 *          GROWI MCP server). The server looks for `markdownQuote` in the body of the
 *          latest revision by plain string matching, renders the body, and computes
 *          the anchor (`quote`, `prefix`, `suffix`, `approxOffset`) from the rendered
 *          text of the chosen occurrence. The stored `quote` is therefore the rendered
 *          text (markdown syntax removed), not `markdownQuote` itself, and
 *          `anchorOriginRevisionId` is the latest revision. Must not be combined with
 *          `anchor` or `anchorOriginRevisionId`.
 *        type: object
 *        required:
 *          - pageId
 *          - comment
 *          - markdownQuote
 *        properties:
 *          pageId:
 *            type: string
 *            description: ID of the page.
 *          comment:
 *            type: string
 *            description: Comment body (markdown).
 *          markdownQuote:
 *            type: string
 *            minLength: 1
 *            maxLength: 2000
 *            description: >
 *              An exact substring of the page body markdown, markdown syntax included
 *              (for example `**bold** text`), at most 2000 UTF-16 code units long.
 *              Occurrences are counted without overlap.
 *          markdownOffset:
 *            type: integer
 *            minimum: 0
 *            description: >
 *              UTF-16 index in the body where the chosen occurrence of `markdownQuote`
 *              starts. Required only when `markdownQuote` occurs more than once: send
 *              back the `offset` of one of the candidates returned with the error
 *              `inline-comment-quote-ambiguous`, rather than counting characters. When
 *              there are more occurrences than the listed candidates, make
 *              `markdownQuote` longer so that it occurs fewer times.
 *          revisionId:
 *            type: string
 *            description: >
 *              ID of the revision the caller read `markdownQuote` from. When given and
 *              it is not the latest revision, the request is refused with 409.
 *      InlineCommentQuoteCandidate:
 *        description: One occurrence of `markdownQuote` in the page body markdown.
 *        type: object
 *        required:
 *          - offset
 *          - line
 *          - snippet
 *        properties:
 *          offset:
 *            type: integer
 *            description: >
 *              UTF-16 index in the body where the occurrence starts; send it as
 *              `markdownOffset` to choose this occurrence.
 *          line:
 *            type: integer
 *            description: 1-based line number of the occurrence.
 *          snippet:
 *            type: string
 *            description: >
 *              The occurrence with a little of the markdown around it. An occurrence
 *              longer than 40 code units is cut and ends with `…`.
 */

type CreateTarget = Pick<
  CreateInlineCommentInput,
  'anchorOriginRevisionId' | 'anchor'
>;

type CreateTargetResolution =
  | { readonly kind: 'resolved'; readonly target: CreateTarget }
  | {
      readonly kind: 'refused';
      readonly error: ErrorV3;
      readonly status: number;
    };

const refused = (
  message: string,
  code: string,
  status: number,
  args?: Record<string, unknown>,
): CreateTargetResolution => ({
  kind: 'refused',
  error: new ErrorV3(message, code, undefined, args),
  status,
});

const targetFromAnchor = async (
  requestBody: CreateInlineCommentByAnchorRequestBody,
): Promise<CreateTargetResolution> => {
  const { pageId, anchorOriginRevisionId, anchor } = requestBody;

  // A revision of another page must not be linked; an unknown id is harmless anchor metadata.
  const anchorRevision = await prisma.revisions.findUnique({
    where: { id: anchorOriginRevisionId },
    select: { pageId: true },
  });
  if (anchorRevision != null && !isRevisionOfPage(anchorRevision, pageId)) {
    return refused(
      'The revision does not belong to this page.',
      'inline-comment-create-failed',
      400,
    );
  }
  return { kind: 'resolved', target: { anchorOriginRevisionId, anchor } };
};

const MARKDOWN_QUOTE_REFUSALS: Record<
  Exclude<MarkdownQuoteAnchorResolution['kind'], 'anchored'>,
  { readonly message: string; readonly code: string }
> = {
  'not-found': {
    message: 'markdownQuote does not occur in the latest revision of the page.',
    code: 'inline-comment-quote-not-found',
  },
  ambiguous: {
    message:
      'markdownQuote occurs more than once; send markdownOffset with the offset of one of the candidates.',
    code: 'inline-comment-quote-ambiguous',
  },
  'offset-mismatch': {
    message: 'No occurrence of markdownQuote starts at markdownOffset.',
    code: 'inline-comment-quote-offset-mismatch',
  },
  'not-anchorable': {
    message:
      'The selected part of the markdown shows no text on the page, or is drawn as a diagram.',
    code: 'inline-comment-quote-not-anchorable',
  },
};

const refusedMarkdownQuote = (
  resolution: Exclude<MarkdownQuoteAnchorResolution, { kind: 'anchored' }>,
): CreateTargetResolution => {
  const { message, code } = MARKDOWN_QUOTE_REFUSALS[resolution.kind];
  return refused(
    message,
    code,
    400,
    'candidates' in resolution
      ? { candidates: resolution.candidates, total: resolution.total }
      : undefined,
  );
};

const targetFromMarkdownQuote = async (
  requestBody: CreateInlineCommentByMarkdownQuoteRequestBody,
  latestRevisionId: string | null,
): Promise<CreateTargetResolution> => {
  const { markdownQuote, markdownOffset, revisionId } = requestBody;

  if (revisionId != null && revisionId !== latestRevisionId) {
    return refused(
      'The page was updated after the given revision.',
      'inline-comment-revision-outdated',
      409,
    );
  }

  const latestRevision =
    latestRevisionId == null
      ? null
      : await prisma.revisions.findUnique({
          where: { id: latestRevisionId },
          select: { body: true },
        });
  if (latestRevisionId == null || latestRevision == null) {
    // A page without a body cannot contain the (non-empty) quote.
    return refusedMarkdownQuote({ kind: 'not-found' });
  }

  const resolution = await resolveMarkdownQuoteAnchor(
    { id: latestRevisionId, body: latestRevision.body },
    markdownQuote,
    markdownOffset,
  );
  if (resolution.kind !== 'anchored') {
    return refusedMarkdownQuote(resolution);
  }
  return {
    kind: 'resolved',
    target: {
      anchorOriginRevisionId: latestRevisionId,
      anchor: resolution.anchor,
    },
  };
};

/**
 * @swagger
 *
 *    /inline-comments:
 *      post:
 *        tags: [Comments]
 *        summary: Create an inline comment
 *        description: >
 *          Creates an origin inline comment anchored to a passage of the page body. The
 *          passage is given in one of two ways: an anchor measured against the rendered
 *          text (`CreateInlineCommentByAnchorRequest`; see `InlineCommentAnchor` for how
 *          the anchor is measured and used when the page is displayed), or a part of the
 *          body markdown, from which the server computes the anchor
 *          (`CreateInlineCommentByMarkdownQuoteRequest`). Requires login, or an access
 *          token with the scope `write:features:page`, and permission to view the page.
 *          Not available through a share link. Read-only users are refused unless
 *          read-only users are allowed to comment.
 *        requestBody:
 *          required: true
 *          content:
 *            application/json:
 *              schema:
 *                oneOf:
 *                  - $ref: '#/components/schemas/CreateInlineCommentByAnchorRequest'
 *                  - $ref: '#/components/schemas/CreateInlineCommentByMarkdownQuoteRequest'
 *        responses:
 *          201:
 *            description: The created inline comment.
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  required:
 *                    - inlineComment
 *                  properties:
 *                    inlineComment:
 *                      $ref: '#/components/schemas/InlineComment'
 *          400:
 *            description: >
 *              Invalid input, both `anchor` and `markdownQuote` sent, `markdownOffset`
 *              or `revisionId` sent without `markdownQuote`, or the caller is a
 *              read-only user (code `validation_failed`); an empty `anchor.quote`, or
 *              an `anchorOriginRevisionId` of a revision of another page (code
 *              `inline-comment-create-failed`). With `markdownQuote`: it does not occur in
 *              the latest revision (code `inline-comment-quote-not-found`); it occurs
 *              more than once and `markdownOffset` is not given (code
 *              `inline-comment-quote-ambiguous`); no occurrence starts at
 *              `markdownOffset` (code `inline-comment-quote-offset-mismatch`); the chosen
 *              range shows no text on the page (an image, a formula or markup only) or
 *              reaches into a code block drawn as a diagram (`drawio`, `mermaid`,
 *              `plantuml`) (code `inline-comment-quote-not-anchorable`). The ambiguous
 *              and offset-mismatch errors list the first 20 occurrences in document
 *              order in `args.candidates` and the number of all occurrences in
 *              `args.total`.
 *            content:
 *              application/json:
 *                schema:
 *                  allOf:
 *                    - $ref: '#/components/schemas/ErrorV3'
 *                    - type: object
 *                      properties:
 *                        args:
 *                          type: object
 *                          properties:
 *                            total:
 *                              type: integer
 *                              description: The number of all occurrences of `markdownQuote`.
 *                            candidates:
 *                              type: array
 *                              maxItems: 20
 *                              items:
 *                                $ref: '#/components/schemas/InlineCommentQuoteCandidate'
 *          403:
 *            description: Not authenticated, or the access token lacks the required scope.
 *          404:
 *            description: >
 *              The page does not exist, or the caller may not view it. The two cases
 *              are deliberately indistinguishable (code `notfound_or_forbidden`).
 *            content:
 *              application/json:
 *                schema:
 *                  $ref: '#/components/schemas/ErrorV3'
 *          409:
 *            description: >
 *              With `markdownQuote`: `revisionId` is not the latest revision of the page
 *              (code `inline-comment-revision-outdated`). Read the page again and retry.
 *            content:
 *              application/json:
 *                schema:
 *                  $ref: '#/components/schemas/ErrorV3'
 */
export const createInlineCommentRouteHandlersFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const loginRequired = loginRequiredFactory(crowi, false);
  const { pageService, pageGrantService } = crowi;

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    excludeReadOnlyUserIfCommentNotAllowed,
    ...validator,
    apiV3FormValidator,
    async (req: Req, res: ApiV3Response) => {
      const { user } = req;
      assert(
        user != null,
        'user is required (ensured by loginRequired middleware)',
      );
      assert(
        crowi.commentService != null,
        'commentService must be initialized',
      );

      const requestBody = req.body;
      const { pageId, comment } = requestBody;

      // Viewer-filtered lookup; uniform 404 on any failure, page missing or
      // forbidden — see apps/app/.claude/rules/page-write-action-403-404.md.
      const { data: page, meta } = await findPageAndMetaDataByViewer(
        pageService,
        pageGrantService,
        { pageId, path: null, user, basicOnly: true },
      );
      if (page == null || isIPageNotFoundInfo(meta)) {
        return res.apiv3Err(
          new ErrorV3(
            'Page is not found or forbidden',
            'notfound_or_forbidden',
          ),
          404,
        );
      }

      let resolution: CreateTargetResolution;
      try {
        resolution =
          requestBody.markdownQuote != null
            ? await targetFromMarkdownQuote(
                requestBody,
                page.revision == null ? null : getIdStringForRef(page.revision),
              )
            : await targetFromAnchor(requestBody);
      } catch (err) {
        logger.error('Failed to resolve the inline comment anchor', err);
        return res.apiv3Err(
          new ErrorV3(
            'Failed to create inline comment',
            'inline-comment-create-failed',
          ),
          500,
        );
      }
      if (resolution.kind === 'refused') {
        return res.apiv3Err(resolution.error, resolution.status);
      }

      const service = new InlineCommentService({
        prisma,
        commentService: crowi.commentService,
        updateCommentCount: updatePageCommentCount,
      });

      try {
        const inlineComment = await service.create(
          { pageId, comment, ...resolution.target },
          user._id.toString(),
        );
        return res.apiv3({ inlineComment }, 201);
      } catch (err) {
        // The service's only precondition error here is an empty anchor.quote.
        logger.error('Failed to create inline comment', err);
        return res.apiv3Err(
          new ErrorV3(
            err instanceof Error
              ? err.message
              : 'Failed to create inline comment',
            'inline-comment-create-failed',
          ),
          400,
        );
      }
    },
  ];
};
